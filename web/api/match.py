"""
Vercel Python 함수: 자동 매칭 실행  (DESIGN.md 4.7, PRD MAT-01)

  POST /api/match                      → 매칭 마감 시각이 지난, 아직 실행 안 된 가장 이른 날짜 실행 (pg_cron용)
  POST /api/match?date=2026-10-22      → 특정 날짜 실행 (어드민 "지금 실행"용)
  POST /api/match?date=...&dry_run=1   → DB에 쓰지 않고 결과만 반환

인증: 헤더 Authorization: Bearer <MATCH_SECRET>
환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MATCH_SECRET
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))

import numpy as np  # noqa: E402

from _engine.bayes import NIG  # noqa: E402
from _engine.load import build_inputs  # noqa: E402
from _engine.matcher import Matcher, Policy  # noqa: E402

KST = timezone(timedelta(hours=9))
FEATURE_NAMES = ["gender", "mbti", "interest", "desired", "novelty"]
ALGO_VERSION = "v2"


# ---------------------------------------------------------------- 순수 계산 (DB 없이 테스트 가능)
def kst_date(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(KST).date().isoformat()


def due_date(rows: dict, now: datetime) -> str | None:
    """매칭 마감이 지났고 아직 실행되지 않은 가장 이른 회차 날짜."""
    done = {r["run_key"] for r in rows.get("match_runs", [])}
    due = sorted({kst_date(s["starts_at"]) for s in rows["event_slots"]
                  if datetime.fromisoformat(s["match_run_at"].replace("Z", "+00:00")) <= now})
    return next((d for d in due if d not in done), None)


def compute(rows: dict, date: str, settings: dict, model: dict | None, seed: int = 42) -> dict:
    m = settings.get("matching", {})
    weights = [m.get("weights", {}).get(k, 0.0) for k in FEATURE_NAMES]
    nig = NIG.from_json(model["params"]) if model else NIG.prior(weights)
    beta_mean = nig.mu
    policy_name = m.get("policy", "mean")              # 'mean' | 'thompson'
    beta_opt = nig.sample(np.random.default_rng(seed)) if policy_name == "thompson" else beta_mean
    y_min = 3 + 2 * float(m.get("min_score", 0.45))

    day_slots = [s for s in rows["event_slots"] if kst_date(s["starts_at"]) == date]
    people, apps, slots, ex, met = build_inputs(
        rows["profiles"], rows["applications"], rows["application_slots"], day_slots,
        rows["venue_availability"], rows.get("excluded_pairs", []), rows.get("met_pairs", []))

    pol = Policy(beta_opt=beta_opt, beta_mean=beta_mean, y_min=y_min,
                 size_min=m.get("table_size", {}).get("min", 4), size_max=m.get("table_size", {}).get("max", 6),
                 max_age_gap=m.get("max_age_gap", 8), gender_rule=m.get("gender_rule", {}), seed=seed)
    res = Matcher(people, apps, slots, ex, met, pol).run()

    app_person = {a.id: a.person_id for a in apps}
    tables = []
    for t in res.tables:
        ps = [people[app_person[a]] for a in t.members]
        shared = [k for k, c in Counter(i for p in ps for i in p.interests).most_common() if c >= 2][:3]
        tables.append({
            "slot_id": t.slot_id,
            "members": t.members,
            "phi": dict(zip(FEATURE_NAMES, [round(x, 3) for x in t.phi])),
            "pred": round(t.pred_mean, 3),
            # 참가자에게 보여줄 근거: 타인 개인정보·상세 점수 제외 (PRD MAT-12)
            "explanation": {"size": len(ps), "shared_interests": shared,
                            "criteria": ["희망 날짜·지역", "연령대", "성비", "MBTI", "관심사", "만나고 싶은 사람"]},
            "reasons": {a: res.placement.get(a, {}) for a in t.members},
        })

    # 매칭 안 된 사람: 이후 날짜를 고른 사람은 이월, 아니면 실패 + 대체 회차
    all_slot_date = {s["id"]: kst_date(s["starts_at"]) for s in rows["event_slots"]}
    chosen = {}
    for r in rows["application_slots"]:
        chosen.setdefault(r["application_id"], set()).add(r["slot_id"])
    future_open = sorted((s for s in rows["event_slots"] if kst_date(s["starts_at"]) > date),
                         key=lambda s: s["starts_at"])
    carry, failed = [], []
    for a, info in res.unmatched.items():
        if any(all_slot_date.get(s, "") > date for s in chosen.get(a, ())):
            carry.append(a)
            continue
        alts = list(info["alternatives"])
        alts += [s["id"] for s in future_open if s["id"] not in chosen.get(a, set()) and s["id"] not in alts]
        failed.append({"application_id": a, "reason": info["reason"], "alternatives": alts[:3]})

    return {
        "run_key": date,
        "algorithm_version": f"{ALGO_VERSION}-{policy_name}",
        "params": {"beta_mean": np.round(beta_mean, 4).tolist(), "beta_opt": np.round(beta_opt, 4).tolist(),
                   "y_min": y_min, "seed": seed},
        "stats": res.stats | {"carried_over": len(carry), "failed": len(failed)},
        "tables": tables,
        "carry_over": carry,
        "failed": failed,
    }


# ---------------------------------------------------------------- Supabase REST
def _env(k: str) -> str:
    v = os.environ.get(k)
    if not v:
        raise RuntimeError(f"환경변수 {k} 없음")
    return v


def _req(method: str, path: str, body=None, extra_headers=None):
    key = _env("SUPABASE_SERVICE_ROLE_KEY")
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    h.update(extra_headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(_env("SUPABASE_URL").rstrip("/") + "/rest/v1/" + path, data=data,
                                 method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt else None


def fetch_all(table: str, query: str = "select=*") -> list:
    out, start, step = [], 0, 1000
    while True:
        rows = _req("GET", f"{table}?{query}", extra_headers={"Range-Unit": "items",
                                                              "Range": f"{start}-{start + step - 1}"})
        out.extend(rows)
        if len(rows) < step:
            return out
        start += step


def load_rows() -> tuple[dict, dict, dict | None]:
    rows = {t: fetch_all(t) for t in ("profiles", "event_slots", "application_slots", "venue_availability",
                                      "excluded_pairs", "met_pairs", "match_runs")}
    rows["applications"] = fetch_all(
        "applications", "select=*&payment_status=eq.PAID&match_status=eq.WAITING&application_status=eq.SUBMITTED")
    settings = {r["key"]: r["value"] for r in fetch_all("settings")}
    snap = fetch_all("model_snapshots", "select=*&order=created_at.desc&limit=1")
    return rows, settings, (snap[0] if snap else None)


def run(date: str | None, dry_run: bool) -> dict:
    rows, settings, model = load_rows()
    date = date or due_date(rows, datetime.now(timezone.utc))
    if not date:
        return {"status": "NOTHING_DUE"}
    payload = compute(rows, date, settings, model)
    if dry_run:
        return {"status": "DRY_RUN", "run_key": date, "stats": payload["stats"]}
    result = _req("POST", "rpc/apply_match_run", {"payload": payload})
    return {"status": "APPLIED", "run_key": date, "stats": payload["stats"], "db": result}


# ---------------------------------------------------------------- HTTP 핸들러
class handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.headers.get("Authorization", "") != f"Bearer {os.environ.get('MATCH_SECRET', '')}" \
                or not os.environ.get("MATCH_SECRET"):
            return self._send(401, {"error": "unauthorized"})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            out = run(q.get("date", [None])[0], q.get("dry_run", ["0"])[0] == "1")
            self._send(200, out)
        except Exception as e:  # 실패는 그대로 보고 (운영자 확인용)
            self._send(500, {"error": str(e)})

    def do_GET(self):
        self._send(405, {"error": "POST only"})

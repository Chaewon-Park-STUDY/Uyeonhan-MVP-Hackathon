"""
Vercel Python 함수: 피드백으로 매칭 모형 학습 (DESIGN.md 4.5, PRD FB-08)

  POST /api/learn            → 사후분포 갱신 후 model_snapshots 에 저장
  POST /api/learn?dry_run=1  → 저장하지 않고 결과만

  y_T = 테이블 만족도 평균(1~5), φ(T) = 매칭 때 저장한 5개 특성
  매번 '사전분포 + 지금까지의 모든 테이블'로 다시 계산한다 (같은 데이터를 두 번 반영하지 않음).
  /api/match 도 매칭 직전에 이 함수를 불러 항상 최신 사후분포로 매칭한다.
인증: Authorization: Bearer <MATCH_SECRET>
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))

import numpy as np  # noqa: E402

from _engine.bayes import NIG  # noqa: E402

FEATURE_NAMES = ["gender", "mbti", "interest", "desired", "novelty"]


def posterior(outcomes: list[dict], settings: dict) -> tuple[NIG, int]:
    w = settings.get("matching", {}).get("weights", {})
    prior = NIG.prior([w.get(k, 0.0) for k in FEATURE_NAMES])
    rows = [o for o in outcomes if o.get("phi") and o.get("y") is not None]
    if not rows:
        return prior, 0
    Phi = np.array([[float(o["phi"].get(k, 0.0)) for k in FEATURE_NAMES] for o in rows])
    y = np.array([float(o["y"]) for o in rows])
    return prior.update(Phi, y), len(rows)


def summarize(nig: NIG, n: int) -> dict:
    sd = nig.coef_sd()
    return {"n_tables": n,
            "intercept": round(float(nig.mu[0]), 3),
            "coef": {k: round(float(m), 3) for k, m in zip(FEATURE_NAMES, nig.mu[1:])},
            "coef_sd": {k: round(float(s), 3) for k, s in zip(FEATURE_NAMES, sd[1:])},
            "sigma": round(float(np.sqrt(nig.sigma2_mean)), 3)}


def learn(dry_run: bool = False) -> dict:
    from match import _req, fetch_all   # 같은 폴더의 REST 헬퍼 재사용
    settings = {r["key"]: r["value"] for r in fetch_all("settings")}
    outcomes = fetch_all("table_outcomes")
    nig, n = posterior(outcomes, settings)
    out = summarize(nig, n)
    if dry_run or n == 0:
        return {"status": "DRY_RUN" if dry_run else "NO_DATA", **out}
    last = fetch_all("model_snapshots", "select=n_obs&order=created_at.desc&limit=1")
    if last and last[0]["n_obs"] == n:
        return {"status": "UNCHANGED", **out}
    _req("POST", "model_snapshots", {"version": "v2-nig", "params": nig.to_json(), "n_obs": n},
         extra_headers={"Prefer": "return=minimal"})
    return {"status": "SAVED", **out}


class handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        secret = os.environ.get("MATCH_SECRET")
        if not secret or self.headers.get("Authorization", "") != f"Bearer {secret}":
            return self._send(401, {"error": "unauthorized"})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            self._send(200, learn(q.get("dry_run", ["0"])[0] == "1"))
        except Exception as e:
            self._send(500, {"error": str(e)})

    def do_GET(self):
        self._send(405, {"error": "POST only"})

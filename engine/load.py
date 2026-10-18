"""
DB 행(dict) → 엔진 입력 변환. Supabase REST든 로컬 Postgres든 같은 형태의 행을 넣으면 된다.
"""
from __future__ import annotations

from collections import defaultdict

from .features import Person, pair_key
from .matcher import Application, Slot


def build_inputs(profiles, applications, application_slots, event_slots, venue_availability,
                 excluded_pairs=(), met_pairs=()):
    people = {
        p["id"]: Person(
            id=p["id"], birth_year=int(p["birth_year"]), gender=p["gender"], mbti=p.get("mbti"),
            interests=frozenset(p.get("interests") or []),
            self_traits=frozenset(p.get("self_traits") or []),
            desired=frozenset(p.get("desired_traits") or []),
        )
        for p in profiles
    }
    tables_per_slot = defaultdict(int)
    for v in venue_availability:
        tables_per_slot[v["slot_id"]] += int(v["tables_total"]) - int(v.get("tables_used") or 0)
    slots = {
        s["id"]: Slot(id=s["id"], date=str(s["starts_at"])[:10], region=s["region_code"],
                      max_tables=tables_per_slot.get(s["id"], 0))
        for s in event_slots
    }
    by_app = defaultdict(list)
    for r in application_slots:
        if r["slot_id"] in slots:
            by_app[r["application_id"]].append(r["slot_id"])
    apps = [
        Application(id=a["id"], person_id=a["user_id"], slot_ids=sorted(by_app[a["id"]]))
        for a in applications
        if a.get("payment_status") == "PAID" and a.get("match_status") in ("WAITING", None) and by_app[a["id"]]
    ]
    ex = {pair_key(r["u1"], r["u2"]) for r in excluded_pairs}
    met = {pair_key(r["u1"], r["u2"]) for r in met_pairs}
    return people, apps, slots, ex, met

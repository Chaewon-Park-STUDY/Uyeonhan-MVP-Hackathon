"""
W5-4 Thompson Sampling 시뮬레이션 (docs/DESIGN.md 4.6)

질문: 피드백으로 매칭 가중치를 학습할 때
  STATIC  : 운영자 가중치를 그대로 쓴다 (학습 없음)
  GREEDY  : 사후평균 β̂ 로 매칭 (활용만)
  THOMPSON: 사후표본 β̃ ~ p(β|data) 로 매칭 (탐색 + 활용)
중 무엇이 참가자 만족도를 가장 빨리 끌어올리는가?

설정
  - 참가자 풀 300명(가상), 매 회차 120명이 신청, 지역 3곳 × 최대 8테이블
  - 참값 β* 는 운영자 가중치와 다르게 둔다: 실제로는 "관심사·원하는 사람"이 더 중요하다고 가정
  - 테이블 만족도 y = β*₀ + β*ᵀφ + ε, ε ~ N(0, 0.35²)
  - 한 번 같은 테이블이었던 쌍은 이후 novelty 가 떨어짐 (회차가 지날수록 상태가 변함)
  - 회차별 regret = (참값 β* 로 매칭했을 때의 기대 만족도 합) − (정책 매칭의 기대 만족도 합)
실행:  cd web && python ../scripts/sim_thompson.py
"""
from __future__ import annotations

import json
import random
import sys
import time
from itertools import combinations
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "web" / "api"))
from _engine.bayes import NIG  # noqa: E402
from _engine.features import DESIRED_MAP, Person, pair_key, phi  # noqa: E402
from _engine.matcher import Application, Matcher, Policy, Slot  # noqa: E402

W_OPERATOR = [0.30, 0.25, 0.20, 0.15, 0.10]
BETA_TRUE = np.array([2.6, 0.35, 0.15, 1.10, 0.70, 0.30])   # 관심사·원하는 사람이 실제로 더 중요
NOISE = 0.35
ROUNDS, SEEDS, POOL, APPLY = 30, 5, 300, 120
GENDER_RULE = {"single_minority_score": 0.0, "same_gender_score": 0.3}

TRAITS = ["경청을 잘 함", "깊은 대화를 좋아함", "가볍고 유머 있는 대화를 좋아함",
          "잔잔하고 조용한 편", "활기차고 에너지 있는 편", "이야기를 이끄는 편"]
INTERESTS = ["운동", "맛집·카페 탐방", "여행", "영화·드라마", "음악", "독서·글쓰기", "자기계발·공부",
             "전시·공연·아트", "패션·뷰티", "사진·영상"]
DESIRED = list(DESIRED_MAP) + ["나와 비슷한 사람", "나와 다른 자극을 주는 사람"]
MBTI = [a + b + c + d for a in "EI" for b in "SN" for c in "TF" for d in "JP"]


def population(seed: int) -> dict[str, Person]:
    r = random.Random(seed)
    return {f"p{i}": Person(f"p{i}", r.randint(1990, 2003), r.choice("MF"), r.choice(MBTI),
                            frozenset(r.sample(INTERESTS, r.randint(2, 4))), frozenset(r.sample(TRAITS, 2)),
                            frozenset(r.sample(DESIRED, r.randint(1, 2))))
            for i in range(POOL)}


def round_inputs(people, rnd: int, seed: int):
    r = random.Random(seed * 1000 + rnd)
    date = f"R{rnd:02d}"
    slots = {f"{date}-{g}": Slot(f"{date}-{g}", date, g, 8) for g in ("A", "B", "C")}
    apps = [Application(f"{pid}@{rnd}", pid, sorted(r.sample(list(slots), r.randint(1, 2))))
            for pid in r.sample(list(people), APPLY)]
    return apps, slots


def run_match(people, apps, slots, met, beta_opt, beta_mean, seed):
    pol = Policy(beta_opt=beta_opt, beta_mean=beta_mean, y_min=0.0, gender_rule=GENDER_RULE,
                 ls_iters=1500, seed=seed)
    res = Matcher(people, apps, slots, set(), met, pol).run()
    a2p = {a.id: a.person_id for a in apps}
    return [[a2p[m] for m in t.members] for t in res.tables]


def true_value(people, tables, met):
    """참값 기준 기대 만족도 합 (사람 수 가중) — 매칭 못 된 사람은 0."""
    return sum(len(t) * (BETA_TRUE[0] + BETA_TRUE[1:] @ np.array(phi([people[p] for p in t], met, GENDER_RULE)))
               for t in tables)


def simulate(policy: str, seed: int) -> dict:
    people = population(seed)
    rng = np.random.default_rng(seed)
    prior = NIG.prior(W_OPERATOR)
    Phi_hist, y_hist, met = [], [], set()
    out = {"regret": [], "sat": [], "coef_err": [], "matched": []}
    for rnd in range(ROUNDS):
        post = prior.update(np.array(Phi_hist), np.array(y_hist)) if y_hist else prior
        if policy == "STATIC":
            b_opt = b_mean = prior.mu
        elif policy == "GREEDY":
            b_opt = b_mean = post.mu
        else:
            b_opt, b_mean = post.sample(rng), post.mu
        apps, slots = round_inputs(people, rnd, seed)
        tables = run_match(people, apps, slots, met, b_opt, b_mean, seed + rnd)
        oracle = run_match(people, apps, slots, met, BETA_TRUE, BETA_TRUE, seed + rnd)
        v_pol, v_orc = true_value(people, tables, met), true_value(people, oracle, met)
        n = sum(len(t) for t in tables)

        for t in tables:                                    # 피드백 관측 → 다음 회차 학습
            f = phi([people[p] for p in t], met, GENDER_RULE)
            Phi_hist.append(f)
            y_hist.append(float(BETA_TRUE[0] + BETA_TRUE[1:] @ np.array(f) + rng.normal(0, NOISE)))
        for t in tables:                                    # 함께 앉은 쌍은 이후 novelty 감소
            met |= {pair_key(a, b) for a, b in combinations(t, 2)}

        out["regret"].append(max(v_orc - v_pol, 0.0) / APPLY)        # 신청자 1인당
        out["sat"].append(v_pol / max(n, 1))
        out["coef_err"].append(float(np.linalg.norm(post.mu[1:] - BETA_TRUE[1:])))
        out["matched"].append(n / APPLY)
    return out


def main():
    t0 = time.time()
    res = {p: [simulate(p, s) for s in range(SEEDS)] for p in ("STATIC", "GREEDY", "THOMPSON")}
    summary = {}
    for p, runs in res.items():
        reg = np.array([r["regret"] for r in runs])
        summary[p] = {
            "cum_regret_mean": np.cumsum(reg, axis=1).mean(0).round(3).tolist(),
            "cum_regret_sd": np.cumsum(reg, axis=1).std(0).round(3).tolist(),
            "sat_mean": np.array([r["sat"] for r in runs]).mean(0).round(3).tolist(),
            "coef_err_mean": np.array([r["coef_err"] for r in runs]).mean(0).round(3).tolist(),
            "matched_mean": float(np.mean([r["matched"] for r in runs])),
        }
    out = Path(__file__).resolve().parents[1] / "docs" / "reports" / "sim_thompson.json"
    out.write_text(json.dumps({"config": {"rounds": ROUNDS, "seeds": SEEDS, "pool": POOL, "apply": APPLY,
                                          "beta_true": BETA_TRUE.tolist(), "w_operator": W_OPERATOR,
                                          "noise": NOISE}, "summary": summary}, ensure_ascii=False, indent=1))
    for p, s in summary.items():
        print(f"{p:9s} 누적regret(30회)={s['cum_regret_mean'][-1]:.3f}±{s['cum_regret_sd'][-1]:.3f}  "
              f"마지막 5회 만족도={np.mean(s['sat_mean'][-5:]):.3f}  계수오차 {s['coef_err_mean'][0]:.2f}→{s['coef_err_mean'][-1]:.2f}  "
              f"매칭률={s['matched_mean']:.3f}")
    print(f"{time.time() - t0:.0f}s → {out}")


if __name__ == "__main__":
    main()

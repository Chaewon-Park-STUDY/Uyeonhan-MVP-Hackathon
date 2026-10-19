"""
매칭 엔진 자체 점검 (실데이터 없이 합성 신청자로 실행)
    python -m engine.selftest
필수 조건 위반·중복 배치가 0이어야 하고, 베이지안 갱신이 참값 쪽으로 이동해야 한다.
"""
import random

import numpy as np

from .bayes import NIG
from .features import DESIRED_MAP, Person, hard_ok
from .matcher import Application, Matcher, Policy, Slot

TRAITS = ["경청을 잘 함", "깊은 대화를 좋아함", "가볍고 유머 있는 대화를 좋아함",
          "잔잔하고 조용한 편", "활기차고 에너지 있는 편", "이야기를 이끄는 편"]
INTERESTS = ["운동", "맛집·카페 탐방", "여행", "영화·드라마", "음악", "독서·글쓰기", "자기계발·공부"]
DESIRED = list(DESIRED_MAP) + ["나와 비슷한 사람", "나와 다른 자극을 주는 사람"]


def synthetic(n=200, seed=1):
    r = random.Random(seed)
    slots = {f"{d}-{g}": Slot(f"{d}-{g}", d, g, 6) for d in ("2026-10-22", "2026-10-29") for g in ("A", "B")}
    people, apps = {}, []
    for i in range(n):
        pid = f"p{i}"
        people[pid] = Person(
            pid, r.randint(1990, 2004), r.choice("MFF"),
            r.choice([None, "ENTP", "INFJ", "ESFJ", "ISTP"]),
            frozenset(r.sample(INTERESTS, 3)), frozenset(r.sample(TRAITS, 2)), frozenset(r.sample(DESIRED, 2)))
        apps.append(Application(f"a{i}", pid, sorted(r.sample(list(slots), r.randint(1, 3)))))
    return people, apps, slots


def main():
    people, apps, slots = synthetic()
    prior = NIG.prior([0.30, 0.25, 0.20, 0.15, 0.10])
    pol = Policy(prior.mu, prior.mu, y_min=3.9, gender_rule={"single_minority_score": 0.0, "same_gender_score": 0.3})
    res = Matcher(people, apps, slots, set(), set(), pol).run()
    app_person = {a.id: a.person_id for a in apps}
    viol = [t for t in res.tables
            if not (4 <= len(t.members) <= 6 and hard_ok([people[app_person[m]] for m in t.members], set()))]
    ids = [m for t in res.tables for m in t.members]
    print("stats:", res.stats)
    print("필수 조건 위반:", len(viol), "/ 중복 배치:", len(ids) - len(set(ids)))
    assert not viol and len(ids) == len(set(ids))

    rng = np.random.default_rng(0)
    true = np.array([3.0, 0.4, 0.1, 1.2, 0.3, 0.4])
    Phi = rng.uniform(0, 1, (200, 5))
    y = true[0] + Phi @ true[1:] + rng.normal(0, 0.5, 200)
    post = prior.update(Phi, y)
    print("사전평균:", prior.mu.round(2), "→ 사후평균:", post.mu.round(2), "(참값:", true, ")")
    assert np.abs(post.mu - true).mean() < np.abs(prior.mu - true).mean()
    print("OK")


if __name__ == "__main__":
    main()

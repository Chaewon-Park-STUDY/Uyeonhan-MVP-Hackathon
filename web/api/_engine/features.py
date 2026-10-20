"""
선호 조건 점수 φ(T) ∈ [0,1]^5  (docs/DESIGN.md 4.2, 4.3)

φ = (성비, MBTI, 관심사, 희망 성향, 새로운 사람)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

FEATURES = ("gender", "mbti", "interest", "desired", "novelty")

# 희망 성향 → 상대의 "나는 어떤 사람" 중 하나라도 있으면 충족 (DESIGN 4.3)
DESIRED_MAP: dict[str, set[str]] = {
    "편하고 유머 있는 사람": {"가볍고 유머 있는 대화를 좋아함"},
    "잔잔하고 안정적인 사람": {"잔잔하고 조용한 편", "경청을 잘 함"},
    "깊은 대화가 되는 사람": {"깊은 대화를 좋아함"},
    "열정 있는 사람": {"활기차고 에너지 있는 편", "이야기를 이끄는 편"},
}
SIMILAR, DIFFERENT = "나와 비슷한 사람", "나와 다른 자극을 주는 사람"
SIMILAR_TH, DIFFERENT_TH = 0.4, 0.2   # 가상데이터 쌍 분포의 상위 33% / 하위 23%


@dataclass(frozen=True)
class Person:
    id: str
    birth_year: int
    gender: str                      # 'M' | 'F'
    mbti: str | None = None
    interests: frozenset[str] = field(default_factory=frozenset)
    self_traits: frozenset[str] = field(default_factory=frozenset)
    desired: frozenset[str] = field(default_factory=frozenset)

    @property
    def profile_set(self) -> frozenset[str]:
        return self.interests | self.self_traits


def jaccard(a: frozenset, b: frozenset) -> float:
    u = a | b
    return len(a & b) / len(u) if u else 0.0


def pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


# ---------------------------------------------------------------- 항목별 점수
def gender_score(members: list[Person], single_minority=0.0, same_gender=0.3) -> float:
    n = len(members)
    m = sum(p.gender == "M" for p in members)
    f = n - m
    minority = min(m, f)
    if minority == 0:
        return same_gender
    if minority == 1:
        return single_minority
    return 1 - abs(m - f) / n


def mbti_score(members: list[Person]) -> float:
    known = [p.mbti for p in members if p.mbti]
    if len(known) < 2:
        return 0.5                     # 정보 부족 → 중립
    e = sum(x[0] == "E" for x in known)
    return 1 - abs(e - (len(known) - e)) / len(known)


def interest_score(members: list[Person]) -> float:
    pairs = list(combinations(members, 2))
    return sum(jaccard(a.interests, b.interests) for a, b in pairs) / len(pairs) if pairs else 0.0


def _desire_met(want: str, me: Person, other: Person) -> bool:
    # 동물 카드(v2): "함께하고 싶은 동물" = 상대의 "나와 닮은 동물"과 같은 어휘 → 그대로 비교
    if want in other.self_traits:
        return True
    if want in DESIRED_MAP:
        return bool(DESIRED_MAP[want] & other.self_traits)
    sim = jaccard(me.profile_set, other.profile_set)
    if want == SIMILAR:
        return sim >= SIMILAR_TH
    if want == DIFFERENT:
        return sim <= DIFFERENT_TH
    return False


def desired_score(members: list[Person]) -> float:
    rates = []
    for me in members:
        if not me.desired:
            continue
        others = [o for o in members if o.id != me.id]
        met = sum(any(_desire_met(w, me, o) for o in others) for w in me.desired)
        rates.append(met / len(me.desired))
    return sum(rates) / len(rates) if rates else 0.5


def novelty_score(members: list[Person], met_pairs: set[tuple[str, str]]) -> float:
    pairs = list(combinations(members, 2))
    if not pairs:
        return 1.0
    seen = sum(pair_key(a.id, b.id) in met_pairs for a, b in pairs)
    return 1 - seen / len(pairs)


def phi(members: list[Person], met_pairs: set[tuple[str, str]], gender_rule: dict | None = None) -> list[float]:
    gr = gender_rule or {}
    return [
        gender_score(members, gr.get("single_minority_score", 0.0), gr.get("same_gender_score", 0.3)),
        mbti_score(members),
        interest_score(members),
        desired_score(members),
        novelty_score(members, met_pairs),
    ]


# ---------------------------------------------------------------- 필수 조건
def hard_ok(members: list[Person], excluded: set[tuple[str, str]], max_age_gap: int = 8) -> bool:
    """크기 제약을 뺀 필수 조건 (나이 차이, 제외 관계). 크기는 배치 단계에서 따로 검사."""
    if not members:
        return True
    ys = [p.birth_year for p in members]
    if max(ys) - min(ys) > max_age_gap:
        return False
    return not any(pair_key(a.id, b.id) in excluded for a, b in combinations(members, 2))

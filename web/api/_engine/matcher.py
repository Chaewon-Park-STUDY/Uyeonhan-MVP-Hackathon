"""
배치 알고리즘 (docs/DESIGN.md 4.7)

회차 날짜 순으로 처리한다. 날짜 d에서:
  1. 후보 각자에게 주 지역 지정 (그 날짜에 고른 지역 중 후보가 가장 많은 지역)
  2. 지역(=회차)마다 테이블 구성: 나이순 초기 분할 → 맞바꾸기·이동 지역탐색(local search)
  3. 남은 사람 → 같은 날짜의 다른 희망 지역에 삽입 또는 새 테이블   (재배치 1·2순위)
  4. 그래도 남으면 → 고른 다른 날짜로 넘김                           (재배치 3·4순위)
마지막까지 남은 사람은 ALTERNATIVE_OFFERED + 가능한 대체 회차 추천.

필수 조건(4~6명, 나이 차이, 제외 관계)은 완화하지 않는다.
확정은 사후평균 기준 예측 만족도 ≥ y_min 일 때만 (탐색용 샘플 β̃ 로 확정하지 않음).
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from .features import Person, hard_ok, phi


# ---------------------------------------------------------------- 입력/출력 구조
@dataclass(frozen=True)
class Slot:
    id: str
    date: str            # 'YYYY-MM-DD'
    region: str
    max_tables: int      # 배정 가능한 식당 테이블 수


@dataclass
class Application:
    id: str
    person_id: str
    slot_ids: list[str]


@dataclass
class Policy:
    beta_opt: np.ndarray            # 배치 최적화에 쓰는 계수 (v3면 표본 β̃)
    beta_mean: np.ndarray           # 확정 판단에 쓰는 사후평균
    y_min: float                    # 확정 최소 예측 만족도 (1~5점)
    size_min: int = 4
    size_max: int = 6
    max_age_gap: int = 8
    gender_rule: dict = field(default_factory=dict)
    ls_iters: int = 4000
    seed: int = 42


@dataclass
class Table:
    slot_id: str
    members: list[str]                       # application id
    phi: list[float] = field(default_factory=list)
    pred_mean: float = 0.0
    confirmed: bool = False


@dataclass
class Result:
    tables: list[Table]
    unmatched: dict[str, dict]               # app_id → {reason, alternatives}
    placement: dict[str, dict]               # app_id → {slot_id, reallocations, reason}
    stats: dict


# ---------------------------------------------------------------- 엔진
class Matcher:
    def __init__(self, people: dict[str, Person], apps: list[Application], slots: dict[str, Slot],
                 excluded: set[tuple[str, str]], met_pairs: set[tuple[str, str]], policy: Policy):
        self.people, self.slots, self.pol = people, slots, policy
        self.apps = {a.id: a for a in apps}
        self.excluded, self.met = excluded, met_pairs
        self.rng = random.Random(policy.seed)
        self.realloc = defaultdict(int)
        self.reason: dict[str, str] = {}

    # ------------------------------------------------------------ 점수
    def _persons(self, app_ids):
        return [self.people[self.apps[a].person_id] for a in app_ids]

    def _phi(self, app_ids):
        return phi(self._persons(app_ids), self.met, self.pol.gender_rule)

    def _valid(self, app_ids) -> bool:
        return hard_ok(self._persons(app_ids), self.excluded, self.pol.max_age_gap)

    def _table_obj(self, app_ids) -> float:
        """테이블 목적함수: 인원 × 예측 만족도 증분(β·φ). 필수 조건/크기 위반은 큰 벌점."""
        n = len(app_ids)
        if n == 0:
            return 0.0
        pen = 0.0
        if not self._valid(app_ids):
            pen += 100.0
        if n < self.pol.size_min or n > self.pol.size_max:
            pen += 100.0
        return n * float(np.dot(self.pol.beta_opt[1:], self._phi(app_ids))) - pen

    # ------------------------------------------------------------ 한 회차의 테이블 구성
    def _options_left(self, app_id: str, date: str) -> int:
        return sum(self.slots[s].date > date for s in self.apps[app_id].slot_ids)

    def build_tables(self, pool: list[str], slot: Slot, max_tables: int) -> tuple[list[list[str]], list[str]]:
        smin, smax = self.pol.size_min, self.pol.size_max
        n = len(pool)
        if n < smin or max_tables <= 0:
            return [], list(pool)

        k = min(max_tables, max(1, round(n / 5)), n // smin)
        k = max(k, 1)
        overflow: list[str] = []
        if n > k * smax:   # 자리 부족: 다른 날짜 선택지가 많은 사람부터 다음으로 미룸
            ranked = sorted(pool, key=lambda a: -self._options_left(a, slot.date))
            overflow = ranked[: n - k * smax]
            pool = [a for a in pool if a not in set(overflow)]
            n = len(pool)

        # 초기 분할: 나이순 정렬 후 연속 구간으로 나눔 (나이 차이 제약을 먼저 맞추기 위함)
        ordered = sorted(pool, key=lambda a: self.people[self.apps[a].person_id].birth_year)
        sizes = [n // k + (1 if i < n % k else 0) for i in range(k)]
        tables, i = [], 0
        for s in sizes:
            tables.append(ordered[i:i + s])
            i += s

        tables = self._local_search(tables)

        # 필수 조건을 끝내 못 맞춘 테이블은 해체
        good, left = [], list(overflow)
        for t in tables:
            if smin <= len(t) <= smax and self._valid(t):
                good.append(t)
            else:
                left.extend(t)
        # 해체된 사람을 남은 자리에 삽입 시도
        left = [a for a in left if not self._insert(a, good)]
        return good, left

    def _local_search(self, tables: list[list[str]]) -> list[list[str]]:
        if len(tables) < 2:
            return tables
        obj = [self._table_obj(t) for t in tables]
        smin, smax = self.pol.size_min, self.pol.size_max
        for _ in range(self.pol.ls_iters):
            i, j = self.rng.sample(range(len(tables)), 2)
            ti, tj = tables[i], tables[j]
            if not ti or not tj:
                continue
            if self.rng.random() < 0.7:                       # 맞바꾸기
                a, b = self.rng.choice(ti), self.rng.choice(tj)
                ni = [x for x in ti if x != a] + [b]
                nj = [x for x in tj if x != b] + [a]
            else:                                             # 이동
                if len(ti) <= smin or len(tj) >= smax:
                    continue
                a = self.rng.choice(ti)
                ni = [x for x in ti if x != a]
                nj = tj + [a]
            oi, oj = self._table_obj(ni), self._table_obj(nj)
            if oi + oj > obj[i] + obj[j] + 1e-9:
                tables[i], tables[j], obj[i], obj[j] = ni, nj, oi, oj
        return tables

    def _insert(self, app_id: str, tables: list[list[str]]) -> bool:
        """자리가 있는 테이블 중 필수 조건을 지키며 목적함수 증가가 가장 큰 곳에 넣는다."""
        best, best_gain = None, -math.inf
        for t in tables:
            if len(t) >= self.pol.size_max:
                continue
            cand = t + [app_id]
            if not self._valid(cand):
                continue
            gain = self._table_obj(cand) - self._table_obj(t)
            if gain > best_gain:
                best, best_gain = t, gain
        if best is None:
            return False
        best.append(app_id)
        return True

    # ------------------------------------------------------------ 전체 실행
    def run(self) -> Result:
        by_slot: dict[str, list[list[str]]] = defaultdict(list)
        placed: dict[str, str] = {}
        waiting = set(self.apps)
        dates = sorted({s.date for s in self.slots.values()})

        for d in dates:
            cands = [a for a in waiting if any(self.slots[s].date == d for s in self.apps[a].slot_ids)]
            if not cands:
                continue
            # 1. 주 지역: 선택지가 적은 사람부터, 좌석 대비 배정 비율이 가장 낮은 지역으로 (쏠림 방지)
            primary = defaultdict(list)
            seats = {s: max(1, self.slots[s].max_tables * self.pol.size_max) for s in self.slots}
            opts_at_d = {a: sorted(s for s in self.apps[a].slot_ids if self.slots[s].date == d) for a in cands}
            for a in sorted(cands, key=lambda a: (len(opts_at_d[a]), a)):
                s_best = min(opts_at_d[a], key=lambda s: (len(primary[s]) / seats[s], s))
                primary[s_best].append(a)

            # 2. 회차별 구성
            leftovers = []
            for sid, pool in primary.items():
                tables, left = self.build_tables(pool, self.slots[sid], self.slots[sid].max_tables)
                by_slot[sid].extend(tables)
                for t in tables:
                    for a in t:
                        placed[a] = sid
                        self.reason.setdefault(a, "희망 날짜·지역에 배치")
                leftovers.extend(left)

            # 3. 같은 날짜의 다른 희망 지역
            still = []
            for a in leftovers:
                done = False
                for s in self.apps[a].slot_ids:
                    if self.slots[s].date != d or s == placed.get(a):
                        continue
                    if self._insert(a, by_slot[s]):
                        placed[a], done = s, True
                        self.realloc[a] += 1
                        self.reason[a] = "같은 날짜의 다른 희망 지역으로 재배치"
                        break
                if not done:
                    still.append(a)
            # 남은 사람끼리 다른 희망 지역에서 새 테이블
            for s in sorted({s for a in still for s in self.apps[a].slot_ids if self.slots[s].date == d}):
                room = self.slots[s].max_tables - len(by_slot[s])
                pool = [a for a in still if s in self.apps[a].slot_ids and a not in placed]
                tables, _ = self.build_tables(pool, self.slots[s], room)
                for t in tables:
                    by_slot[s].append(t)
                    for a in t:
                        placed[a] = s
                        self.realloc[a] += 1
                        self.reason[a] = "같은 날짜의 다른 희망 지역으로 재배치"

            for a in cands:
                if a in placed:
                    waiting.discard(a)
                elif any(self.slots[s].date > d for s in self.apps[a].slot_ids):
                    self.realloc[a] += 1
                    self.reason[a] = "희망한 다른 날짜로 재배치"
            # 4. 다른 날짜가 없는 사람은 waiting에 남아 최종 실패 처리

        # ---------------- 확정 판단 (사후평균 기준)
        tables: list[Table] = []
        dissolved: list[str] = []
        for sid, ts in by_slot.items():
            for members in ts:
                f = self._phi(members)
                pred = float(self.pol.beta_mean[0] + np.dot(self.pol.beta_mean[1:], f))
                ok = pred >= self.pol.y_min and self._valid(members) and \
                    self.pol.size_min <= len(members) <= self.pol.size_max
                if ok:
                    tables.append(Table(sid, members, f, pred, True))
                else:
                    dissolved.extend(members)
                    for a in members:
                        placed.pop(a, None)
                        self.reason[a] = "최소 점수 미달로 확정 보류"

        # 점수 미달로 해체된 사람: 확정 테이블의 빈자리에 재삽입 (확정 기준 유지 시에만)
        for a in dissolved:
            best, best_pred = None, -math.inf
            for t in tables:
                if len(t.members) >= self.pol.size_max:
                    continue
                if not any(s == t.slot_id for s in self.apps[a].slot_ids):
                    continue
                cand = t.members + [a]
                if not self._valid(cand):
                    continue
                f = self._phi(cand)
                pred = float(self.pol.beta_mean[0] + np.dot(self.pol.beta_mean[1:], f))
                if pred >= self.pol.y_min and pred > best_pred:
                    best, best_pred, best_f = t, pred, f
            if best is not None:
                best.members.append(a)
                best.phi, best.pred_mean = best_f, best_pred
                placed[a] = best.slot_id
                self.realloc[a] += 1
                self.reason[a] = "점수 미달 테이블 해체 후 다른 테이블로 재배치"

        unmatched_ids = [a for a in self.apps if a not in placed]
        unmatched = {a: {"reason": self.reason.get(a, "조건을 만족하는 테이블 없음"),
                         "alternatives": self._alternatives(a, tables)} for a in unmatched_ids}
        placement = {a: {"slot_id": s, "reallocations": self.realloc[a], "reason": self.reason.get(a, "")}
                     for a, s in placed.items()}
        sizes = [len(t.members) for t in tables]
        stats = {
            "applications": len(self.apps),
            "tables_confirmed": len(tables),
            "placed": len(placed),
            "unmatched": len(unmatched_ids),
            "reallocated_placed": sum(1 for a in placed if self.realloc[a] > 0),
            "dissolved_low_score": len(dissolved),
            "dissolved_rescued": sum(1 for a in dissolved if a in placed),
            "table_size_dist": {k: sizes.count(k) for k in sorted(set(sizes))},
            "mean_pred": round(float(np.mean([t.pred_mean for t in tables])), 3) if tables else None,
        }
        return Result(tables, unmatched, placement, stats)

    def _alternatives(self, app_id: str, tables: list[Table], k: int = 3) -> list[str]:
        """신청하지 않은 회차 중, 자리가 있고 필수 조건을 만족하는 테이블이 있는 회차 추천."""
        chosen = set(self.apps[app_id].slot_ids)
        out = []
        for t in sorted(tables, key=lambda t: -t.pred_mean):
            if t.slot_id in chosen or t.slot_id in out or len(t.members) >= self.pol.size_max:
                continue
            if self._valid(t.members + [app_id]):
                out.append(t.slot_id)
            if len(out) >= k:
                break
        return out

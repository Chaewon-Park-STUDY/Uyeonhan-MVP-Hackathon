"""
가상 신청 데이터(구글폼 응답 엑셀) → Supabase 시드 SQL 변환

사용법:
    python scripts/build_seed.py private/<가상데이터>.xlsx
출력:
    private/seed.sql   (gitignore 대상 — 레포에 올라가지 않음)

정제 규칙 (docs/DESIGN.md 6장 기준)
  - 나이 → 출생연도 (2026 − 나이)
  - 성별 남/여 → M/F
  - MBTI 대문자 정규화, 형식이 틀리면 null
  - 중복 신청 병합: (이름, 나이, 성별, MBTI)가 같으면 같은 사람으로 보고 1명으로 합침.
    희망 지역은 합집합, 나머지 응답은 마지막 응답 사용, 신청 횟수는 재방문 이력으로 집계
  - 지역: 서울 4권역으로 매핑. 서울 외 지역만 고른 신청자는 매칭 대신 지역 대기 명단(region_waitlist)에 등록 (FAQ Q9)
  - 관심사·성향: 설문 선택지 사전과 대조해 추출 (선택지 안의 쉼표 때문에 단순 split 불가)
  - 못 먹는 음식: 자유 입력 → 알레르기 / 비선호 태그로 분류, 원문은 '기타'로 보존
  - 참가 날짜: 원본은 지난 날짜이므로, 고른 날짜 수만큼 다가오는 목요일 회차에 재배정 (난수 시드 고정)
  - 이용권: 1회권 → SINGLE, 3·4회권 → MEMBERSHIP_1M (FAQ Q4 가격 체계로 이관)
"""
import random
import re
import sys
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl

RNG = random.Random(42)
KST = timezone(timedelta(hours=9))
YEAR = 2026

# ---------------------------------------------------------------- 사전
REGION_MAP = [
    (r"홍대|합정", "HONGDAE"),
    (r"강남|신논현", "GANGNAM"),
    (r"을지로|종로", "EULJIRO"),
    (r"잠실", "JAMSIL"),
]
ALL_SEOUL = r"서울권\s*모두|서울\s*상관|무방|상관\s*없|아무\s*데나|어디든"

INTERESTS = ["운동 (헬스, 러닝, 클라이밍 등)", "맛집·카페 탐방", "여행", "영화·드라마", "음악",
             "독서·글쓰기", "자기계발·공부", "전시·공연·아트", "패션·뷰티", "사진·영상"]
INTEREST_LABEL = {"운동 (헬스, 러닝, 클라이밍 등)": "운동"}
SELF_TRAITS = ["경청을 잘 함", "깊은 대화를 좋아함", "가볍고 유머 있는 대화를 좋아함",
               "잔잔하고 조용한 편", "활기차고 에너지 있는 편", "이야기를 이끄는 편"]
DESIRED = ["편하고 유머 있는 사람", "잔잔하고 안정적인 사람", "깊은 대화가 되는 사람",
           "나와 비슷한 사람", "나와 다른 자극을 주는 사람", "열정 있는 사람"]
BUDGETS = ["10,000~20,000원", "20,000~30,000원", "30,000원 이상 (상관 없음)"]

NONE_FOOD = re.compile(r"^\s*(없|x|X|아니|다\s*잘|no)", re.I)
DISLIKE_RULES = [
    (r"회|날것|날거|육회|초밥|게장", "날것"),
    (r"해산물|조개|굴|새우|해물", "해산물"),
    (r"내장|곱창|대창|막창|닭발", "내장류"),
    (r"매운|마라|맵", "매운음식"),
    (r"고수", "고수"),
    (r"오이", "오이"),
]
ALLERGY_RULES = [
    (r"갑각|새우\s*알레|게\s*알레", "갑각류"),
    (r"견과|땅콩", "견과류"),
    (r"유제품|우유", "유제품"),
    (r"밀가루|글루텐", "밀"),
    (r"계란|달걀", "달걀"),
]

VENUES = {  # 시연용 가상 식당 (실존 상호 아님)
    "HONGDAE": [("[샘플] 홍대 비스트로 온기", ["양식"], 4.6), ("[샘플] 합정 한식주점 소반", ["한식", "매운음식"], 4.5),
                ("[샘플] 홍대 스시 하루", ["일식", "날것", "해산물"], 4.7)],
    "GANGNAM": [("[샘플] 신논현 파스타 바", ["양식", "유제품"], 4.4), ("[샘플] 강남 곱창 화로", ["한식", "내장류"], 4.3),
                ("[샘플] 강남 샤브 정원", ["일식", "해산물"], 4.6)],
    "EULJIRO": [("[샘플] 을지로 노포 식당", ["한식"], 4.5), ("[샘플] 종로 타코 하우스", ["멕시칸", "고수", "매운음식"], 4.4),
                ("[샘플] 을지로 와인 다이닝", ["양식", "견과류"], 4.7)],
    "JAMSIL":  [("[샘플] 잠실 브런치 테이블", ["양식", "달걀"], 4.5), ("[샘플] 잠실 마라 키친", ["중식", "매운음식"], 4.2),
                ("[샘플] 송리단길 이자카야", ["일식", "해산물", "날것"], 4.6)],
}
UPCOMING_THURSDAYS = [datetime(2026, 10, 22, 19, 30, tzinfo=KST),
                      datetime(2026, 10, 29, 19, 30, tzinfo=KST),
                      datetime(2026, 11, 5, 19, 30, tzinfo=KST)]


# ---------------------------------------------------------------- 헬퍼
def q(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def arr(xs):
    return "array[" + ",".join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"


def ts(dt):
    return q(dt.isoformat())


def pick(text, options):
    t = str(text or "")
    return [o for o in options if o in t]


def regions_of(text):
    t = str(text or "")
    if re.search(ALL_SEOUL, t):
        return [code for _, code in REGION_MAP]
    return [code for pat, code in REGION_MAP if re.search(pat, t)]


def food_of(text):
    t = str(text or "").strip()
    if not t or NONE_FOOD.match(t):
        return [], [], None
    allergies = [tag for pat, tag in ALLERGY_RULES if re.search(pat, t)]
    dislikes = [tag for pat, tag in DISLIKE_RULES if re.search(pat, t)]
    return allergies, dislikes, t


def mbti_of(v):
    m = str(v or "").strip().upper()
    return m if re.fullmatch(r"[EI][SN][TF][JP]", m) else None


def slot_deadline(starts):  # 화요일 24:00 = 수요일 00:00 KST (FAQ Q1)
    d = (starts - timedelta(days=1)).date()
    return datetime(d.year, d.month, d.day, 0, 0, tzinfo=KST)


# ---------------------------------------------------------------- 본체
def main(xlsx_path: str, out_path: str = "private/seed.sql"):
    ws = openpyxl.load_workbook(xlsx_path, data_only=True).worksheets[0]
    header_row = next(i for i, r in enumerate(ws.iter_rows(values_only=True), 1) if r[0] == "타임스탬프")
    rows = [r for r in ws.iter_rows(min_row=header_row + 1, values_only=True) if r[1]]

    out, stats = [], Counter()
    out.append("-- 자동 생성: scripts/build_seed.py  (가상데이터 기반, 레포 업로드 금지)\nbegin;\n")

    # 회차
    slots = {}
    for starts in UPCOMING_THURSDAYS:
        for _, code in REGION_MAP:
            sid = str(uuid.uuid4())
            slots[(starts, code)] = sid
            dl = slot_deadline(starts)
            out.append(f"insert into event_slots(id, region_code, starts_at, capacity, apply_deadline, match_run_at) "
                       f"values ({q(sid)}, {q(code)}, {ts(starts)}, 36, {ts(dl)}, {ts(dl)});")

    # 식당 + 회차별 수용
    for code, vs in VENUES.items():
        for name, tags, rating in vs:
            vid = str(uuid.uuid4())
            out.append(f"insert into venues(id, region_code, name, address, price_range, rating, menu_tags) values "
                       f"({q(vid)}, {q(code)}, {q(name)}, {q('(시연용 주소) ' + name)}, '20,000~30,000원', {rating}, {arr(tags)});")
            for starts in UPCOMING_THURSDAYS:
                out.append(f"insert into venue_availability(venue_id, slot_id, tables_total) values "
                           f"({q(vid)}, {q(slots[(starts, code)])}, 3);")

    # 중복 신청 병합
    people = {}
    for r in rows:
        if r[4] is None:
            continue
        key = (str(r[1]).strip(), int(r[4]), r[5], (mbti_of(r[7]) or str(r[7] or "").strip().upper()))
        if key in people:
            prev = people[key]
            people[key] = {"row": r, "region_text": prev["region_text"] + ", " + str(r[8] or ""), "n": prev["n"] + 1}
        else:
            people[key] = {"row": r, "region_text": str(r[8] or ""), "n": 1}
    stats["중복 신청 병합(제거된 행)"] = len([r for r in rows if r[4] is not None]) - len(people)
    stats["2회 이상 신청한 사람"] = sum(p["n"] > 1 for p in people.values())

    # 신청자
    for person in people.values():
        r = person["row"]
        name, age, sex, mbti = r[1], r[4], r[5], r[7]
        regs = regions_of(person["region_text"])
        if age is None or sex not in ("남", "여"):
            stats["제외: 나이·성별 누락"] += 1
            continue

        pid = str(uuid.uuid4())
        allergies, dislikes, food_raw = food_of(r[16])
        interests = [INTEREST_LABEL.get(x, x) for x in pick(r[9], INTERESTS)]
        out.append(
            "insert into profiles(id, name, birth_year, gender, job, mbti, interests, self_traits, desired_traits, "
            "allergies, food_dislikes, budget_ranges, privacy_agreed_at) values ("
            f"{q(pid)}, {q(name)}, {YEAR - int(age)}, {q('M' if sex == '남' else 'F')}, {q(r[6])}, {q(mbti_of(mbti))}, "
            f"{arr(interests)}, {arr(pick(r[10], SELF_TRAITS))}, {arr(pick(r[11], DESIRED))}, "
            f"{arr(allergies)}, {arr(dislikes + ([f'기타:{food_raw}'] if food_raw and not (allergies or dislikes) else []))}, "
            f"{arr(pick(r[12], BUDGETS))}, now());")
        stats["MBTI 누락·형식오류"] += mbti_of(mbti) is None

        # 서울 외 지역만 고른 사람 → 대기 명단 (매칭 대상 아님)
        if not regs:
            area = re.sub(r"\s+", " ", person["region_text"]).strip(" ,") or "미기재"
            out.append(f"insert into region_waitlist(profile_id, area_text) values ({q(pid)}, {q(area)});")
            stats["지역 대기 명단 등록"] += 1
            continue
        stats["음식 제약 있음"] += bool(allergies or dislikes or food_raw)

        # 이용권
        ticket = str(r[14] or "")
        pass_id = str(uuid.uuid4())
        if "1회권" in ticket or not ticket:
            out.append(f"insert into passes(id, user_id, type, remaining) values ({q(pass_id)}, {q(pid)}, 'SINGLE', 1);")
            price = 9900
        else:
            out.append(f"insert into passes(id, user_id, type, expires_at) values "
                       f"({q(pass_id)}, {q(pid)}, 'MEMBERSHIP_1M', now() + interval '1 month');")
            price = 35000
            stats["멤버십으로 이관"] += 1

        # 신청: 원래 고른 날짜 수(최대 2)만큼 다가오는 목요일에 재배정
        n_dates = max(1, min(2, len(re.findall(r"\d+/\d+", str(r[13] or "")))))
        dates = sorted(RNG.sample(UPCOMING_THURSDAYS, n_dates))
        app_id = str(uuid.uuid4())
        out.append(f"insert into applications(id, user_id, pass_id, fail_pref, application_status, payment_status, "
                   f"match_status, submitted_at) values ({q(app_id)}, {q(pid)}, {q(pass_id)}, 'MOVE_DATE', "
                   f"'SUBMITTED', 'PAID', 'WAITING', now());")
        for d in dates:
            for code in regs:
                out.append(f"insert into application_slots(application_id, slot_id) values "
                           f"({q(app_id)}, {q(slots[(d, code)])});")
        out.append(f"insert into payments(application_id, amount, status, idempotency_key) values "
                   f"({q(app_id)}, {price}, 'PAID', {q('seed-' + app_id)});")
        stats["시드 신청자"] += 1
        stats["성별 " + sex] += 1

    out.append("\ncommit;")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text("\n".join(out), encoding="utf-8")

    print(f"원본 응답 {len(rows)}건 → {out_path}")
    for k, v in sorted(stats.items()):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("사용법: python scripts/build_seed.py private/<가상데이터>.xlsx")
    main(*sys.argv[1:])

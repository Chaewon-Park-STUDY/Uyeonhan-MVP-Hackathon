// 화면에 쓰는 선택지와 상태 문구 (DB enum ↔ 한국어)

export const INTERESTS = ["운동", "맛집·카페 탐방", "여행", "영화·드라마", "음악", "독서·글쓰기", "자기계발·공부",
  "전시·공연·아트", "패션·뷰티", "사진·영상"];
export const SELF_TRAITS = ["경청을 잘 함", "깊은 대화를 좋아함", "가볍고 유머 있는 대화를 좋아함",
  "잔잔하고 조용한 편", "활기차고 에너지 있는 편", "이야기를 이끄는 편"];
export const DESIRED = ["편하고 유머 있는 사람", "잔잔하고 안정적인 사람", "깊은 대화가 되는 사람",
  "나와 비슷한 사람", "나와 다른 자극을 주는 사람", "열정 있는 사람"];
export const ALLERGIES = ["갑각류", "견과류", "유제품", "밀", "달걀"];
export const DISLIKES = ["해산물", "날것", "내장류", "매운음식", "고수", "오이"];
export const BUDGETS = ["10,000~20,000원", "20,000~30,000원", "30,000원 이상 (상관 없음)"];

export const PASSES = [
  { value: "SINGLE", label: "1회권", price: 9900, note: "이번 한 번 참여" },
  { value: "MEMBERSHIP_1M", label: "멤버십 1개월", price: 35000, note: "기간 내 무제한 참여" },
  { value: "MEMBERSHIP_3M", label: "멤버십 3개월", price: 75000, note: "기간 내 무제한 참여" },
  { value: "MEMBERSHIP_6M", label: "멤버십 6개월", price: 120000, note: "기간 내 무제한 참여" },
] as const;

export const FAIL_PREFS = [
  { value: "MOVE_DATE", label: "가능한 다른 날짜로 옮겨 주세요" },
  { value: "MOVE_REGION", label: "같은 날 다른 지역도 괜찮아요" },
  { value: "KEEP_PASS", label: "이용권을 보관할게요" },
  { value: "REFUND", label: "환불해 주세요" },
] as const;

export const REFUND_POLICY = [
  "모임 주 화요일 24:00까지 취소하면 전액 환불돼요.",
  "화요일 24:00 이후에는 환불이 어려워요. (매칭이 이때 확정돼요)",
  "매칭이 안 되면 언제나 전액 환불되거나, 원하는 다른 회차로 옮길 수 있어요.",
  "당일 취소와 노쇼는 환불되지 않고, 90일 안에 2회가 쌓이면 30일간 신청이 제한돼요.",
];

export const PAYMENT_LABEL: Record<string, string> = {
  PENDING: "결제 대기",
  PAID: "결제 완료",
  FAILED: "결제 실패",
  REFUND_AVAILABLE: "환불 가능",
  REFUND_REQUESTED: "환불 요청됨",
  REFUND_PROCESSING: "환불 처리 중",
  REFUNDED: "환불 완료",
  REFUND_FAILED: "환불 실패 (운영자 확인 중)",
};

export const MATCH_LABEL: Record<string, { label: string; tone: "wait" | "ok" | "warn" | "muted" }> = {
  WAITING: { label: "매칭 대기", tone: "wait" },
  MATCHING: { label: "매칭 중", tone: "wait" },
  REALLOCATING: { label: "다른 테이블 찾는 중", tone: "wait" },
  CONFIRMED: { label: "매칭 확정", tone: "ok" },
  ALTERNATIVE_OFFERED: { label: "다른 일정 선택 필요", tone: "warn" },
  TRANSFERRED: { label: "다른 회차로 이동", tone: "wait" },
  NO_MATCH: { label: "매칭 종료", tone: "muted" },
  EXCEPTION: { label: "운영자 확인 중", tone: "warn" },
};

export const REGION_LABEL: Record<string, string> = {
  HONGDAE: "홍대/합정",
  GANGNAM: "강남/신논현",
  EULJIRO: "을지로/종로",
  JAMSIL: "잠실",
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// 마감 시각: 00:00(KST)은 "전날 밤 12시"로 표기 — "21일 오전 12:00"은 헷갈림
export function fmtDeadline(iso: string) {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  if (kst.getUTCHours() === 0 && kst.getUTCMinutes() === 0) {
    const prev = new Date(d.getTime() - 60 * 1000);
    const day = prev.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
    return `${day} 밤 12시`;
  }
  return fmtDate(iso);
}

// MBTI: 네 축 모두 버튼으로 선택 (필수)
export const MBTI_AXES = [
  { name: "mbti_ei", title: "에너지", options: [["E", "외향", "사람을 만나면 충전돼요"], ["I", "내향", "혼자 있어야 충전돼요"]] },
  { name: "mbti_sn", title: "인식", options: [["S", "감각", "지금의 구체적인 것에 집중해요"], ["N", "직관", "가능성과 의미를 먼저 떠올려요"]] },
  { name: "mbti_tf", title: "판단", options: [["T", "사고", "논리와 원칙으로 판단해요"], ["F", "감정", "사람과 관계를 먼저 생각해요"]] },
  { name: "mbti_jp", title: "생활", options: [["J", "계획", "미리 정해 두는 게 편해요"], ["P", "즉흥", "그때그때 맞추는 게 편해요"]] },
] as const;

export const ageBand = (birthYear: number) => {
  const age = new Date().getFullYear() - birthYear;
  const decade = Math.floor(age / 10) * 10;
  const part = age % 10 <= 3 ? "초반" : age % 10 <= 6 ? "중반" : "후반";
  return `${decade}대 ${part}`;
};

export const won =(n: number) => `${n.toLocaleString("ko-KR")}원`;

// DB 함수가 던지는 오류 코드 → 안내 문구
export const ERROR_TEXT: Record<string, string> = {
  PROFILE_REQUIRED: "먼저 프로필을 작성해 주세요.",
  PRIVACY_CONSENT_REQUIRED: "개인정보 수집·이용에 동의해야 신청할 수 있어요.",
  NO_SLOT_SELECTED: "참가할 회차를 하나 이상 골라 주세요.",
  SLOT_CLOSED: "신청이 마감된 회차가 있어요. 다른 회차를 골라 주세요.",
  ALREADY_APPLIED: "이미 신청한 회차가 포함돼 있어요.",
  INVALID_COUPON: "사용할 수 없는 쿠폰이에요.",
  SLOT_NOT_OFFERED: "제안된 회차 중에서 골라 주세요.",
  RESTRICTED_UNTIL: "노쇼 누적으로 신청이 잠시 제한돼 있어요.",
};

export function errorText(message: string) {
  const code = Object.keys(ERROR_TEXT).find((k) => message.includes(k));
  return code ? ERROR_TEXT[code] : "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}

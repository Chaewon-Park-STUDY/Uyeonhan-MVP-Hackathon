// 화면에 쓰는 선택지와 상태 문구 (DB enum ↔ 한국어)

export const INTERESTS = ["운동", "맛집·카페 탐방", "여행", "영화·드라마", "음악", "독서·글쓰기", "자기계발·공부",
  "전시·공연·아트", "패션·뷰티", "사진·영상"];
export const SELF_TRAITS = ["경청을 잘 함", "깊은 대화를 좋아함", "가볍고 유머 있는 대화를 좋아함",
  "잔잔하고 조용한 편", "활기차고 에너지 있는 편", "이야기를 이끄는 편"];
export const DESIRED = ["편하고 유머 있는 사람", "잔잔하고 안정적인 사람", "깊은 대화가 되는 사람",
  "나와 비슷한 사람", "나와 다른 자극을 주는 사람", "열정 있는 사람"];
// 동물 카드: "나와 닮은 동물"과 "함께하고 싶은 동물"을 같은 카드로 고른다.
// value 는 기존 성향 문장과 1:1 대응 (시드 데이터·매칭 엔진과 호환)
export type AnimalCard = { value: string; emoji: string; name: string; desc: string };
export const ANIMALS: AnimalCard[] = [
  { value: "경청을 잘 함", emoji: "🐻", name: "잘 들어주는 곰", desc: "이야기를 끝까지 들어줘요" },
  { value: "가볍고 유머 있는 대화를 좋아함", emoji: "🦦", name: "분위기 띄우는 수달", desc: "유머로 어색함을 풀어요" },
  { value: "깊은 대화를 좋아함", emoji: "🦉", name: "깊이 생각하는 부엉이", desc: "진지한 이야기를 좋아해요" },
  { value: "활기차고 에너지 있는 편", emoji: "🐶", name: "먼저 다가가는 강아지", desc: "활기차고 에너지가 넘쳐요" },
  { value: "잔잔하고 조용한 편", emoji: "🐱", name: "곁에 있어 편한 고양이", desc: "잔잔하고 차분해요" },
  { value: "이야기를 이끄는 편", emoji: "🦁", name: "대화를 이끄는 사자", desc: "자연스럽게 화제를 꺼내요" },
];
export const WANT_EXTRA: AnimalCard[] = [
  { value: "나와 비슷한 사람", emoji: "🪞", name: "나를 닮은 친구", desc: "관심사·성향이 비슷한 사람" },
  { value: "나와 다른 자극을 주는 사람", emoji: "🌈", name: "새로운 자극을 주는 친구", desc: "나와 결이 다른 사람" },
];
// 예전 "만나고 싶은 사람" 문장(시드 데이터) → 화면 표시용 동물
const LEGACY_WANT: Record<string, string> = {
  "편하고 유머 있는 사람": "가볍고 유머 있는 대화를 좋아함",
  "잔잔하고 안정적인 사람": "잔잔하고 조용한 편",
  "깊은 대화가 되는 사람": "깊은 대화를 좋아함",
  "열정 있는 사람": "활기차고 에너지 있는 편",
};
// 대표 동물: 고른 카드 중 가장 드문 카드 (시드 264명 기준 선택 빈도 오름차순) → 그 사람만의 특징이 드러나게
const RARITY = ["이야기를 이끄는 편", "활기차고 에너지 있는 편", "잔잔하고 조용한 편",
  "가볍고 유머 있는 대화를 좋아함", "깊은 대화를 좋아함", "경청을 잘 함"];
export const byRarity = (xs?: string[] | null) =>
  [...(xs ?? [])].sort((a, b) => (RARITY.indexOf(a) + 99) % 99 - (RARITY.indexOf(b) + 99) % 99);
export const mainAnimal = (xs?: string[] | null) => animalOf(byRarity(xs)[0]);

export const animalOf = (v?: string) =>
  v === undefined ? undefined :
  [...ANIMALS, ...WANT_EXTRA].find((a) => a.value === (LEGACY_WANT[v] ?? v));

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
  TRANSFERRED: { label: "다른 회차로 이동 · 매칭 대기", tone: "wait" },
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

// 알림 문구 (notifications.template → 제목·본문)
type NotiPayload = { starts_at?: string; venue?: string | null; region?: string; match_run_at?: string; deadline?: string; amount?: number; reason?: string | null };

// 알림 문구 (PRD §14 알림 시나리오 전체) — 템플릿 코드 → 제목·본문
export const NOTI_TEMPLATES: { code: string; when: string; sample: string }[] = [
  { code: "APPLIED", when: "신청 완료", sample: "신청 내용과 수정·취소 방법" },
  { code: "APP_CANCELED", when: "신청 취소", sample: "취소 완료 + 환불 여부" },
  { code: "PAYMENT_PENDING", when: "결제 대기", sample: "결제 방법과 기한(신청 마감)" },
  { code: "PAID", when: "결제 완료", sample: "결제 완료 + 자동 매칭 예정 시각" },
  { code: "REALLOCATING", when: "자동 재배치 중", sample: "조건에 맞는 다른 테이블을 찾는 중" },
  { code: "MATCH_CONFIRMED", when: "매칭 확정", sample: "날짜·지역·식당·단체방 안내" },
  { code: "MATCH_FAILED", when: "매칭 실패", sample: "사유 + 다른 일정 / 이용권 보관 / 환불 선택" },
  { code: "MOVED", when: "일정 이동 완료", sample: "바뀐 회차와 자동 매칭 예정 시각" },
  { code: "REFUND_REQUESTED", when: "환불 요청", sample: "환불 금액과 처리 상태" },
  { code: "REFUNDED", when: "환불 완료", sample: "환불 금액과 완료 안내" },
  { code: "REMINDER_D1", when: "행사 1일 전", sample: "시간·장소·예약명·취소/노쇼 정책 (단체방에도 게시)" },
  { code: "REMINDER_D0", when: "행사 3시간 전", sample: "장소 다시 확인 (단체방에도 게시)" },
  { code: "FEEDBACK_REQUEST", when: "행사 종료 후", sample: "만족도·안전 피드백 요청" },
  { code: "FEEDBACK_REMINDER", when: "피드백 미응답 (1회)", sample: "아직 피드백을 안 남겼으면 하루 뒤 한 번만" },
  { code: "NEXT_RECRUIT", when: "다음 모집 시작", sample: "참여했던 지역의 새 회차 추천" },
];

export function notiText(template: string, p: NotiPayload) {
  const when = p.starts_at ? fmtDate(p.starts_at) : "";
  const where = p.venue ?? (p.region ? REGION_LABEL[p.region] : "");
  const run = p.match_run_at ? fmtDeadline(p.match_run_at) : "마감 직후";
  const amount = p.amount != null ? won(p.amount) : "";
  switch (template) {
    case "APPLIED":
      return { title: "신청이 접수됐어요 📝", body: `${when} ${where} 등 희망 회차. 신청 내용은 홈에서 확인하고, 신청 마감 전까지 홈의 '신청 취소'로 취소할 수 있어요.` };
    case "APP_CANCELED":
      return { title: "신청을 취소했어요", body: `${when} ${where} 신청이 취소됐어요. 결제했다면 전액 환불돼요.` };
    case "PAYMENT_PENDING":
      return { title: "결제를 완료해 주세요", body: `${p.deadline ? fmtDeadline(p.deadline) : "신청 마감"}까지 결제해야 매칭에 들어가요. 홈 → 결제하기` };
    case "PAID":
      return { title: "결제가 완료됐어요 💳", body: `${run}에 자동으로 매칭돼요. 결과는 알림으로 알려 드려요.` };
    case "REALLOCATING":
      return { title: "다른 테이블을 찾고 있어요", body: "처음 조합이 조건에 맞지 않아, 고른 날짜·지역 안에서 다시 맞추는 중이에요." };
    case "MATCH_CONFIRMED":
      return { title: "매칭이 확정됐어요 🎉", body: `${when} ${where}. 단체방에서 먼저 인사해 보세요.` };
    case "MATCH_FAILED":
      return { title: "이번 회차는 매칭되지 않았어요", body: `${p.reason ? `사유: ${p.reason}. ` : "조건에 맞는 테이블을 못 만들었어요. "}다른 일정 · 이용권 보관 · 전액 환불 중에서 골라 주세요.` };
    case "MOVED":
      return { title: "일정을 옮겼어요 📅", body: `${when} ${where} 회차로 옮겼어요. ${run}에 자동으로 매칭돼요.` };
    case "REFUND_REQUESTED":
      return { title: "환불을 진행하고 있어요", body: `${amount} 원래 결제 수단으로 환불 중이에요.` };
    case "REFUNDED":
      return { title: "환불이 완료됐어요", body: `${amount} 환불됐어요. 카드사에 따라 반영까지 며칠 걸릴 수 있어요.` };
    case "REMINDER_D1":
      return { title: "내일 저녁 우연한 식탁", body: `${when} ${where}. 예약명 "우연한 식탁". 못 오게 되면 오늘 중에 알려 주세요.` };
    case "REMINDER_D0":
      return { title: "오늘 저녁 모임 3시간 전", body: `${where}에서 만나요. 위치를 한 번 더 확인해 주세요.` };
    case "FEEDBACK_REQUEST":
      return { title: "오늘 식사는 어떠셨나요?", body: "1분 피드백을 남기면 다음 매칭이 더 잘 맞아져요." };
    case "FEEDBACK_REMINDER":
      return { title: "피드백을 기다리고 있어요", body: "남겨 주신 평가는 다음 테이블을 고르는 데만 쓰여요. 1분이면 충분해요." };
    case "NEXT_RECRUIT":
      return { title: "다음 우연한 식탁이 열렸어요 🍽️", body: `${when} ${where}. 지난번에 오셨던 지역이에요.` };
    default:
      return { title: "알림", body: "" };
  }
}

// 운영자가 고친 문구 적용: {날짜} {장소} {금액} {매칭시각} 자리표시자
export type MsgOverride = { title?: string; body?: string };
export function notiTextWith(overrides: Record<string, MsgOverride> | null | undefined, template: string, p: NotiPayload) {
  const base = notiText(template, p);
  const o = overrides?.[template];
  if (!o || (!o.title && !o.body)) return base;
  const fill = (t: string) => t
    .replaceAll("{날짜}", p.starts_at ? fmtDate(p.starts_at) : "")
    .replaceAll("{장소}", p.venue ?? (p.region ? REGION_LABEL[p.region] : ""))
    .replaceAll("{금액}", p.amount != null ? won(p.amount) : "")
    .replaceAll("{매칭시각}", p.match_run_at ? fmtDeadline(p.match_run_at) : "");
  return { title: o.title ? fill(o.title) : base.title, body: o.body ? fill(o.body) : base.body };
}

export const notiHref = (template: string, p: { table_id?: string; application_id?: string }) =>
  ["FEEDBACK_REQUEST", "FEEDBACK_REMINDER"].includes(template) ? `/feedback/${p.table_id}`
    : template === "MATCH_FAILED" && p.application_id ? `/resolve/${p.application_id}`
    : p.table_id ? `/table/${p.table_id}` : template === "NEXT_RECRUIT" ? "/apply" : "/";

// 시연용 가상 식당 이름의 "[샘플]" 표시는 참가자 화면에서 빼고 보여 줌
export const venueName = (n?: string | null) => (n ?? "").replace(/\[샘플\]\s*/g, "");

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

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
  SCORE_REQUIRED: "테이블 전체 만족도를 골라 주세요.",
  FEEDBACK_CLOSED: "모임이 끝난 뒤에 피드백을 남길 수 있어요.",
  CHECKIN_CLOSED: "체크인은 모임 1시간 전부터 할 수 있어요.",
  CANCEL_CLOSED: "모임이 시작된 뒤에는 취소할 수 없어요.",
  CANCEL_NOT_ALLOWED: "이미 매칭이 진행됐거나 끝난 신청은 여기서 취소할 수 없어요.",
  CANCEL_AFTER_DEADLINE: "신청 마감(화요일 24:00)이 지나 취소할 수 없어요. 확정 뒤에는 테이블 화면에서 참석 취소를 해 주세요.",
  CANCELED_APPLICATION: "취소한 신청이라 결제할 수 없어요. 새로 신청해 주세요.",
  FORBIDDEN_FIELD: "바꿀 수 없는 항목이에요.",
  HAS_UPCOMING_TABLE: "확정된 모임이 남아 있어요. 먼저 테이블 화면에서 참석 취소를 해 주세요.",
  HAS_PENDING_APPLICATION: "결제한 신청이 매칭을 기다리고 있어요. 매칭이 끝난 뒤(또는 환불 후)에 탈퇴할 수 있어요.",
};

export function errorText(message: string) {
  const code = Object.keys(ERROR_TEXT).find((k) => message.includes(k));
  return code ? ERROR_TEXT[code] : "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}

// 지역별 색 (구분이 잘 되게 서로 다른 계열)
export const REGION_COLOR: Record<string, { main: string; soft: string }> = {
  HONGDAE: { main: "#D9485F", soft: "#F9DCE1" },
  EULJIRO: { main: "#2F6FB3", soft: "#DBE8F6" },
  GANGNAM: { main: "#2E8B57", soft: "#D9EFE2" },
  JAMSIL: { main: "#C98A12", soft: "#F8EBCB" },
};

import { Card } from "@/components/ui";
import { MATCH_LABEL, PAYMENT_LABEL } from "@/lib/labels";

// ---------------------------------------------------------------------
// 변경 이력: 코드 대신 쉬운 말, 누가 했는지 색으로 구분
// ---------------------------------------------------------------------
export type Log = { entity: string; entity_id: string; field: string; old_value: string | null; new_value: string | null; actor: string; at: string };

const ACTOR: [string, string, string][] = [
  ["admin:", "운영자", "bg-[#F6DDE0] text-[#7A1F2B]"],
  ["user:", "참가자", "bg-[#DDE9F7] text-[#2C5687]"],
  ["system:matcher", "자동 매칭", "bg-[#D9EFE2] text-[#226B2E]"],
  ["system:attendance", "참석 판정", "bg-[#FDEFC8] text-[#8A5B00]"],
  ["", "시스템", "bg-[#EEE9E4] text-[#6A5F57]"],
];
const actorOf = (a: string) => ACTOR.find(([p]) => a.startsWith(p)) ?? ACTOR[ACTOR.length - 1];
const FIELD: Record<string, string> = {
  payment_status: "결제", match_status: "매칭", application_status: "신청", attendance: "참석", role: "권한",
  restricted_until: "참가 제한", deleted_at: "탈퇴", refund_amount: "환불 금액", is_open: "모집", capacity: "정원",
  apply_deadline: "신청 마감", match_run_at: "자동 매칭 시각", is_active: "사용", is_reservable: "예약 가능",
  admin_note: "처리 메모", admin_action: "조치", venue_id: "식당",
};
const ENTITY: Record<string, string> = {
  application: "신청", applications: "신청", profiles: "회원", table_members: "참석", payments: "결제",
  event_slots: "회차", venues: "식당", exception_cases: "처리대기함", safety_reports: "신고", dining_tables: "테이블",
};
const VALUE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PAYMENT_LABEL)),
  ...Object.fromEntries(Object.entries(MATCH_LABEL).map(([k, v]) => [k, v.label])),
  SUBMITTED: "신청 완료", CANCELED: "취소", DRAFT: "작성 중", SCHEDULED: "참석 예정", ATTENDED: "참석", CANCELED_EARLY: "사전 취소",
  CANCELED_LATE: "당일 취소", NO_SHOW: "노쇼", OPEN: "처리 대기", RESOLVED: "처리 완료", DISSOLVED: "해체",
  WARNING: "경고", RESTRICTED: "30일 제한", BANNED: "영구 제한", DISMISSED: "조치 없음", true: "예", false: "아니요",
  participant: "참가자", admin: "운영자", infinity: "영구",
};
// table_status 의 CONFIRMED 는 매칭 라벨과 같게 "매칭 확정"
const val = (v: string | null) => {
  if (v == null || v === "") return "없음";
  const clean = v.replace(/ \(user [^)]*\)/, "");
  if (VALUE[clean]) return VALUE[clean];
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return new Date(clean).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return clean.length > 30 ? clean.slice(0, 30) + "…" : clean;
};
const time = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function HistoryCard({ logs, settings, nameOf }: { logs: Log[]; settings: { key: string; actor: string; at: string }[]; nameOf: Map<string, string> }) {
  const SETTING: Record<string, string> = { matching: "매칭 기준", demo: "시연 모드", no_show_sanction: "노쇼 규칙", message_overrides: "알림 문구", pricing: "요금" };
  const items = [
    ...logs.map((l) => {
      const who = l.entity === "table_members" ? nameOf.get(/user ([0-9a-f-]{36})/.exec(l.new_value ?? "")?.[1] ?? "") : nameOf.get(l.entity_id);
      const v = (x: string | null) => (l.field === "is_open" ? (x === "true" ? "모집 중" : "닫힘") : l.field === "is_active" ? (x === "true" ? "사용" : "중지") : val(x));
      return { at: l.at, actor: l.actor, what: `${ENTITY[l.entity] ?? l.entity}${FIELD[l.field] && ENTITY[l.entity] !== FIELD[l.field] ? ` · ${FIELD[l.field]}` : ""}`,
               who, from: v(l.old_value), to: v(l.new_value) };
    }),
    ...settings.map((h) => ({ at: h.at, actor: h.actor, what: `설정 · ${SETTING[h.key] ?? h.key}`, who: undefined, from: "", to: "변경" })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">변경 이력</h2>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {ACTOR.map(([, name, cls]) => <span key={name} className={`rounded-full px-2 py-0.5 ${cls}`}>{name}</span>)}
        </div>
      </div>
      {items.length === 0 ? <p className="text-sm text-[#8B6A66]">아직 기록이 없어요.</p> : (
        <ul className="max-h-[420px] divide-y divide-[#F4ECE6] overflow-y-auto">
          {items.map((it, i) => {
            const [, name, cls] = actorOf(it.actor);
            return (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="w-32 shrink-0 whitespace-nowrap text-xs text-[#8B6A66]">{time(it.at)}</span>
                <span className={`w-20 shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs ${cls}`}>{name}</span>
                <span className="font-medium">{it.what}</span>
                {it.who && <span className="text-[#6A4A4C]">{it.who}</span>}
                <span className="ml-auto flex items-center gap-1.5">
                  {it.from && <span className="rounded bg-[#F4ECE6] px-1.5 py-0.5 text-xs text-[#8B6A66] line-through decoration-[#C9B8B3]">{it.from}</span>}
                  {it.from && <span className="text-[#B7A3A0]">→</span>}
                  <span className="rounded bg-[#FBF1EC] px-1.5 py-0.5 text-xs font-semibold text-[#7A1F2B]">{it.to}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

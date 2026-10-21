// 참가자용 회차 일정 — 모임은 매주 목요일 한 번이라 달력 대신 "다가오는 식탁" 날짜 카드로
//   CalendarBoard: 보기 전용 (첫 화면)
//   SlotPicker   : 지역을 눌러 고르기 (신청 화면, 체크박스)
// 색은 브랜드(버건디·크림·골드) 하나로 통일하고, 지역은 작은 점으로만 구분
import { REGION_COLOR, REGION_LABEL, fmtDeadline } from "@/lib/labels";

export type BoardSlot = { id: string; starts_at: string; region_code: string; apply_deadline: string };
export type SlotStat = { slot_id: string; picks: number; capacity: number };

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3);
const ymd = (iso: string) => kst(iso).toISOString().slice(0, 10);
const hm = (iso: string) => kst(iso).toISOString().slice(11, 16);

// 인기·마감 직전 표시
export function slotBadge(s: BoardSlot, sameDay: BoardSlot[], stats: Map<string, SlotStat>) {
  const st = stats.get(s.id);
  const picks = Number(st?.picks ?? 0), cap = Number(st?.capacity ?? 30);
  const maxDay = Math.max(...sameDay.map((x) => Number(stats.get(x.id)?.picks ?? 0)));
  if (picks >= cap * 0.9) return "마감 직전";
  if (picks >= 6 && picks === maxDay) return "인기";
  return null;
}
const soon = (iso: string) => new Date(iso).getTime() - Date.now() < 48 * 3600e3;
const group = (slots: BoardSlot[]) => {
  const m = new Map<string, BoardSlot[]>();
  for (const s of slots) m.set(ymd(s.starts_at), [...(m.get(ymd(s.starts_at)) ?? []), s]);
  return [...m.values()];
};

function DateHead({ list }: { list: BoardSlot[] }) {
  const d = kst(list[0].starts_at);
  const urgent = soon(list[0].apply_deadline);
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-[#7A1F2B] text-[#FBF1EC]">
        <span className="text-[11px] font-semibold leading-none">{d.getUTCMonth() + 1}월</span>
        <span className="text-2xl font-bold leading-tight">{d.getUTCDate()}</span>
      </div>
      <div className="min-w-0">
        <p className="text-base font-bold text-[#2E1B1E]">{DOW[d.getUTCDay()]}요일 저녁 {hm(list[0].starts_at)}</p>
        <p className={`text-xs ${urgent ? "font-semibold text-[#A2412A]" : "text-[#8B6A66]"}`}>
          {urgent ? "⏰ 곧 마감 · " : ""}신청 마감 {fmtDeadline(list[0].apply_deadline)}
        </p>
      </div>
    </div>
  );
}

function Dot({ code }: { code: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: REGION_COLOR[code]?.main }} />;
}

function Badge({ text }: { text: string }) {
  return (
    <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${text === "인기" ? "bg-[#FBEFD0] text-[#8A5B00]" : "bg-[#FCE3DE] text-[#A2412A]"}`}>
      {text === "인기" ? "🔥 인기" : text}
    </span>
  );
}

// 첫 화면: 다가오는 식탁 (보기 전용)
export function CalendarBoard({ slots, stats }: { slots: BoardSlot[]; stats: SlotStat[] }) {
  if (slots.length === 0) return null;
  const st = new Map(stats.map((x) => [x.slot_id, x]));
  return (
    <div className="space-y-3">
      {group(slots).map((list) => (
        <div key={list[0].starts_at} className="rounded-2xl border border-[#EFE3DC] bg-white p-4 shadow-[0_1px_3px_rgba(74,52,38,0.06)]">
          <DateHead list={list} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {list.map((s) => {
              const b = slotBadge(s, list, st);
              return (
                <span key={s.id} className="flex items-center gap-1.5 rounded-full border border-[#E9DCD3] bg-[#FFFCF9] px-3 py-1.5 text-sm text-[#2E1B1E]">
                  <Dot code={s.region_code} />{REGION_LABEL[s.region_code]}{b && <Badge text={b} />}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// 신청 화면: 지역을 눌러 고르기 (고르면 버건디로 채워짐)
export function SlotPicker({ slots, stats }: { slots: BoardSlot[]; stats: SlotStat[] }) {
  const st = new Map(stats.map((x) => [x.slot_id, x]));
  if (slots.length === 0) return <p className="text-sm text-[#8B6A66]">지금 모집 중인 회차가 없어요.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#8B6A66]">갈 수 있는 날짜·지역을 모두 눌러 주세요. 많이 고를수록 매칭될 가능성이 높아져요.</p>
      {group(slots).map((list) => (
        <div key={list[0].starts_at} className="rounded-2xl border border-[#EFE3DC] bg-[#FFFCF9] p-3.5">
          <DateHead list={list} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {list.map((s) => {
              const b = slotBadge(s, list, st);
              return (
                <label key={s.id} className="cursor-pointer">
                  <input type="checkbox" name="slot" value={s.id} className="peer sr-only" />
                  <span className="flex items-center gap-2 rounded-xl border border-[#E9DCD3] bg-white px-3 py-2.5 text-sm font-medium text-[#2E1B1E] transition
                                   peer-checked:border-[#7A1F2B] peer-checked:bg-[#7A1F2B] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#C9A227]">
                    <Dot code={s.region_code} />
                    <span className="flex-1">{REGION_LABEL[s.region_code]}</span>
                    {b && <Badge text={b} />}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

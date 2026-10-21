// 참가자용 "이달의 식탁 일정" — 포스터처럼 큰 달 표시 + 지역 색 블록
//   CalendarBoard: 달력(보기 전용, 랜딩)
//   SlotPicker   : 날짜별 줄 + 지역 색 블록을 눌러 고르기(신청 화면, 체크박스)
import { REGION_COLOR, REGION_LABEL, fmtDeadline } from "@/lib/labels";

export type BoardSlot = { id: string; starts_at: string; region_code: string; apply_deadline: string };
export type SlotStat = { slot_id: string; picks: number; capacity: number };

const EN_MONTH = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3);
const ymd = (iso: string) => kst(iso).toISOString().slice(0, 10);
const hm = (iso: string) => kst(iso).toISOString().slice(11, 16);
const SHORT: Record<string, string> = { HONGDAE: "홍대", GANGNAM: "강남", EULJIRO: "을지로", JAMSIL: "잠실" };

// 인기·마감 임박 표시
export function slotBadge(s: BoardSlot, sameDay: BoardSlot[], stats: Map<string, SlotStat>) {
  const st = stats.get(s.id);
  const picks = Number(st?.picks ?? 0), cap = Number(st?.capacity ?? 30);
  const maxDay = Math.max(...sameDay.map((x) => Number(stats.get(x.id)?.picks ?? 0)));
  if (picks >= cap * 0.9) return "마감 직전";
  if (picks >= 6 && picks === maxDay) return "인기";
  return null;
}
const soon = (iso: string) => new Date(iso).getTime() - Date.now() < 48 * 3600e3;

export function MonthHeader({ iso }: { iso: string }) {
  const d = kst(iso);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="font-black leading-none tracking-tighter text-[#2E1B1E]" style={{ fontSize: "clamp(56px, 12vw, 96px)" }}>{d.getUTCMonth() + 1}</span>
        <span className="leading-tight">
          <span className="block text-lg font-black tracking-[0.2em] text-[#2E1B1E] md:text-2xl">{EN_MONTH[d.getUTCMonth()]}</span>
          <span className="block text-lg font-black tracking-[0.2em] text-[#2E1B1E] md:text-2xl">{d.getUTCFullYear()}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {Object.entries(REGION_LABEL).map(([c, l]) => (
          <span key={c} className="flex items-center gap-1.5 text-lg font-black md:text-2xl" style={{ color: REGION_COLOR[c]?.main }}>
            <span className="h-6 w-2.5 md:h-8 md:w-3" style={{ background: REGION_COLOR[c]?.main }} />{SHORT[c] ?? l}
          </span>
        ))}
      </div>
    </div>
  );
}

// 달력 (태블릿 이상) + 날짜 목록 (휴대폰)
export function CalendarBoard({ slots, stats }: { slots: BoardSlot[]; stats: SlotStat[] }) {
  if (slots.length === 0) return null;
  const st = new Map(stats.map((x) => [x.slot_id, x]));
  const byDay = new Map<string, BoardSlot[]>();
  for (const s of slots) byDay.set(ymd(s.starts_at), [...(byDay.get(ymd(s.starts_at)) ?? []), s]);
  const months = [...new Set([...byDay.keys()].map((d) => d.slice(0, 7)))];

  return (
    <div className="space-y-8">
      {months.map((m) => {
        const first = new Date(`${m}-01T12:00:00+09:00`);
        const lead = (kst(first.toISOString()).getUTCDay() + 6) % 7;            // 월요일 시작
        const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
        const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`)];
        while (cells.length % 7) cells.push(null);
        const monthDays = [...byDay.keys()].filter((d) => d.startsWith(m));
        return (
          <section key={m}>
            <MonthHeader iso={byDay.get(monthDays[0])![0].starts_at} />
            {/* 태블릿 이상: 달력 */}
            <div className="mt-4 hidden border-l-2 border-t-2 border-[#2E1B1E] md:grid md:grid-cols-7">
              {DOW.map((d, i) => (
                <div key={d} className={`border-b-2 border-r-2 border-[#2E1B1E] py-2 text-center text-base font-black ${i === 5 ? "text-[#2F6FB3]" : i === 6 ? "text-[#D9485F]" : "text-[#2E1B1E]"}`}>{d}요일</div>
              ))}
              {cells.map((d, i) => {
                const xs = d ? byDay.get(d) ?? [] : [];
                return (
                  <div key={i} className={`min-h-[110px] border-b-2 border-r-2 border-[#2E1B1E] ${d ? "bg-white" : "bg-[#F4EFEA]"}`}>
                    {d && <p className="px-2 pt-1 text-lg font-black text-[#2E1B1E]">{Number(d.slice(8))}</p>}
                    {xs.length > 0 && (
                      <div className="grid grid-cols-2 gap-px px-1 pb-1">
                        {xs.map((s) => {
                          const b = slotBadge(s, xs, st);
                          return (
                            <div key={s.id} className="flex flex-col items-center justify-center px-1 py-1.5 text-center text-white"
                                 style={{ background: REGION_COLOR[s.region_code]?.main }}>
                              <span className="text-sm font-black leading-tight">{SHORT[s.region_code]}</span>
                              <span className="text-[11px] font-bold leading-tight">{hm(s.starts_at)}</span>
                              {b && <span className="mt-0.5 bg-white px-1 text-[10px] font-black" style={{ color: REGION_COLOR[s.region_code]?.main }}>{b}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 휴대폰: 날짜별 줄 */}
            <div className="mt-4 space-y-3 md:hidden">
              {monthDays.map((d) => <DayRow key={d} list={byDay.get(d)!} stats={st} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayHead({ list }: { list: BoardSlot[] }) {
  const d = kst(list[0].starts_at);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black leading-none text-[#2E1B1E]">{d.getUTCMonth() + 1}.{d.getUTCDate()}</span>
        <span className="whitespace-nowrap text-base font-black text-[#2E1B1E]">{DOW[(d.getUTCDay() + 6) % 7]}요일 {hm(list[0].starts_at)}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#6A4A4C]">
        {soon(list[0].apply_deadline) && <span className="bg-[#2E1B1E] px-1.5 py-0.5 text-[11px] font-black text-white">마감 임박</span>}
        신청 마감 {fmtDeadline(list[0].apply_deadline)}
      </p>
    </div>
  );
}

function DayRow({ list, stats }: { list: BoardSlot[]; stats: Map<string, SlotStat> }) {
  return (
    <div className="border-2 border-[#2E1B1E] bg-white p-3">
      <DayHead list={list} />
      <div className="mt-2 grid grid-cols-4 gap-1">
        {list.map((s) => {
          const b = slotBadge(s, list, stats);
          return (
            <div key={s.id} className="flex flex-col items-center py-2 text-white" style={{ background: REGION_COLOR[s.region_code]?.main }}>
              <span className="text-sm font-black">{SHORT[s.region_code]}</span>
              {b && <span className="mt-0.5 bg-white px-1 text-[10px] font-black" style={{ color: REGION_COLOR[s.region_code]?.main }}>{b}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 신청 화면: 지역 블록을 눌러 여러 개 고르기 (고르면 색이 채워짐)
export function SlotPicker({ slots, stats }: { slots: BoardSlot[]; stats: SlotStat[] }) {
  const st = new Map(stats.map((x) => [x.slot_id, x]));
  const byDay = new Map<string, BoardSlot[]>();
  for (const s of slots) byDay.set(ymd(s.starts_at), [...(byDay.get(ymd(s.starts_at)) ?? []), s]);
  if (byDay.size === 0) return <p className="text-sm text-[#8B6A66]">지금 모집 중인 회차가 없어요.</p>;
  return (
    <div className="space-y-3">
      <MonthHeader iso={slots[0].starts_at} />
      {[...byDay.values()].map((list) => (
        <div key={list[0].starts_at} className="border-2 border-[#2E1B1E] bg-white p-3">
          <DayHead list={list} />
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {list.map((s) => {
              const c = REGION_COLOR[s.region_code];
              const b = slotBadge(s, list, st);
              return (
                <label key={s.id} className="cursor-pointer">
                  <input type="checkbox" name="slot" value={s.id} className="peer sr-only" />
                  <span className="flex flex-col items-center border-2 border-(--c) bg-white py-2.5 text-center text-(--c) peer-checked:bg-(--c) peer-checked:text-white peer-checked:shadow-[inset_0_0_0_2px_#fff] peer-focus-visible:ring-2 peer-focus-visible:ring-[#2E1B1E]"
                        style={{ ["--c" as string]: c?.main }}>
                    <span className="text-base font-black">{SHORT[s.region_code]}</span>
                    {REGION_LABEL[s.region_code] !== SHORT[s.region_code] && <span className="text-[11px] font-semibold opacity-80">{REGION_LABEL[s.region_code]}</span>}
                    {b && <span className="mt-1 bg-[#2E1B1E] px-1.5 text-[10px] font-black text-white">{b}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-[#8B6A66]">갈 수 있는 날짜·지역을 모두 누르세요. 많이 고를수록 매칭될 가능성이 높아져요. 다시 누르면 취소돼요.</p>
    </div>
  );
}

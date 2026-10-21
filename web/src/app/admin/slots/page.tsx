import { Card } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { requireAdmin } from "@/lib/admin";
import { REGION_LABEL, fmtDate, fmtDeadline } from "@/lib/labels";
import { REGION_COLOR } from "../region-map";
import { createSlot, createVenue, setSlotCapacity, setVenueCapacity, toggleSlot, toggleVenue } from "../actions";
import { ALLERGIES, DISLIKES } from "@/lib/labels";

type Slot = { id: string; starts_at: string; region_code: string; is_open: boolean; apply_deadline: string; capacity: number };
type Venue = { id: string; name: string; region_code: string; rating: number | null; menu_tags: string[]; is_active: boolean; is_reservable: boolean;
  venue_availability: { slot_id: string; tables_total: number; tables_used: number }[] };

// PRD §11 회차 관리(만들기·열기/닫기) + 식당 재고 관리(수용 테이블 수)
export default async function Slots({ searchParams }: { searchParams: Promise<{ made?: string; err?: string; venue?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: slots }, { data: venues }] = await Promise.all([
    supabase.from("event_slots").select("id, starts_at, region_code, is_open, apply_deadline, capacity").order("starts_at").order("region_code"),
    supabase.from("venues").select("id, name, region_code, rating, menu_tags, is_active, is_reservable, venue_availability(slot_id, tables_total, tables_used)").order("region_code").order("rating", { ascending: false }),
  ]);
  const list = (slots ?? []) as Slot[];
  // 회차별 신청 수 (희망으로 고른 수)
  const { data: picks } = await supabase.from("application_slots").select("slot_id, applications!inner(application_status)")
    .eq("applications.application_status", "SUBMITTED").limit(10000);
  const pickCount = new Map<string, number>();
  for (const p of picks ?? []) pickCount.set(p.slot_id, (pickCount.get(p.slot_id) ?? 0) + 1);
  // 모임일별로 묶기 (타임라인)
  const kd = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const byDate = new Map<string, Slot[]>();
  for (const x of list) byDate.set(kd(x.starts_at), [...(byDate.get(kd(x.starts_at)) ?? []), x]);
  const nowIso = new Date().toISOString();
  const today = kd(nowIso);
  const dday = (d: string) => {
    const n = Math.round((new Date(`${d}T00:00:00+09:00`).getTime() - new Date(`${today}T00:00:00+09:00`).getTime()) / 86400e3);
    return n === 0 ? "오늘" : n > 0 ? `D-${n}` : `${-n}일 전`;
  };
  const nextSlotIds = new Set(list.filter((s) => s.is_open).map((s) => s.id));

  return (
    <div className="space-y-5">
      {sp.made && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">회차를 만들었어요. 그 지역에 참여했던 분들께 다음 모집 알림이 가요.</p>}
      {sp.venue && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">식당을 추가했어요. 모집 중인 그 지역 회차에 바로 배정 후보로 들어가요.</p>}
      {sp.err && <p className="rounded-xl bg-[#FCEDE8] px-4 py-3 text-sm text-[#A2412A]">{sp.err}</p>}
      <Card>
        <h1 className="mb-1 text-lg font-bold">새 회차 만들기</h1>
        <p className="mb-3 text-xs text-[#8B6A66]">신청 마감 = 자동 매칭 시각이에요. 비워 두면 모임 이틀 전 밤 12시(목요일 모임이면 화요일 24:00)로 정해져요.</p>
        <form action={createSlot} className="grid gap-3 text-sm md:grid-cols-[1fr_1fr_1fr_1fr]">
          <label className="text-xs text-[#6A4A4C]">모임 날짜<input required type="date" name="date" className="mt-1 w-full rounded-lg border border-[#E9DCD3] px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-[#6A4A4C]">시작 시간<input type="time" name="time" defaultValue="19:30" className="mt-1 w-full rounded-lg border border-[#E9DCD3] px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-[#6A4A4C]">정원(명)<input type="number" name="capacity" defaultValue={30} min={4} className="mt-1 w-full rounded-lg border border-[#E9DCD3] px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-[#6A4A4C]">신청 마감·자동 매칭 (선택)<input type="datetime-local" name="deadline" className="mt-1 w-full rounded-lg border border-[#E9DCD3] px-2 py-1.5 text-sm" /></label>
          <div className="md:col-span-3">
            <p className="mb-1 text-xs text-[#6A4A4C]">지역 (여러 개 선택)</p>
            <div className="flex flex-wrap gap-3">
              {Object.entries(REGION_LABEL).map(([code, label]) => (
                <label key={code} className="flex items-center gap-1"><input type="checkbox" name="region" value={code} defaultChecked className="accent-[#7A1F2B]" />{label}</label>
              ))}
            </div>
          </div>
          <label className="text-xs text-[#6A4A4C]">식당당 수용 테이블<input type="number" name="tables" defaultValue={2} min={1} className="mt-1 w-full rounded-lg border border-[#E9DCD3] px-2 py-1.5 text-sm" /></label>
          <div className="md:col-span-4"><PendingButton className="rounded-xl bg-[#7A1F2B] px-4 py-2 text-sm font-semibold text-white" pendingText="만드는 중…">회차 만들기</PendingButton></div>
        </form>
      </Card>

      <Card>
        <h1 className="mb-1 text-lg font-bold">회차 일정</h1>
        <p className="mb-4 text-xs text-[#8B6A66]">모임일별로 묶었어요. 매칭이 실행된 회차는 자동으로 닫히고, 식당 사정 등으로 특정 지역만 미리 닫을 수도 있어요.</p>
        <ol className="relative space-y-5 border-l-2 border-[#EFE3DC] pl-6">
          {[...byDate.entries()].map(([d, xs]) => {
            const past = d < today;
            const deadline = xs[0].apply_deadline;
            const closedAll = xs.every((x) => !x.is_open);
            const state = past ? ["모임 끝남", "bg-[#EEE9E4] text-[#6A5F57]"] : deadline < nowIso ? ["매칭 완료 · 모임 준비", "bg-[#D9EFE2] text-[#226B2E]"]
              : closedAll ? ["모두 닫힘", "bg-[#EEE9E4] text-[#6A5F57]"] : ["모집 중", "bg-[#FDEFC8] text-[#8A5B00]"];
            return (
              <li key={d} className={past ? "opacity-60" : ""}>
                <span className={`absolute -left-[9px] mt-1.5 h-4 w-4 rounded-full border-2 border-white ${past ? "bg-[#C9B8B3]" : deadline < nowIso ? "bg-[#2E8B57]" : "bg-[#C98A12]"}`} />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-lg font-bold">{fmtDate(xs[0].starts_at)}</span>
                  <span className="rounded-full bg-[#7A1F2B] px-2 py-0.5 text-xs font-semibold text-white">{dday(d)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${state[1]}`}>{state[0]}</span>
                  <span className="text-xs text-[#8B6A66]">신청 마감·자동 매칭 {fmtDeadline(deadline)}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {xs.map((x) => {
                    const col = REGION_COLOR[x.region_code];
                    const n = pickCount.get(x.id) ?? 0;
                    return (
                      <div key={x.id} className="rounded-xl border-l-4 bg-[#FBF7F0] px-3 py-2.5" style={{ borderColor: x.is_open ? col?.main : "#C9B8B3" }}>
                        <div className="flex items-center justify-between gap-2">
                          <b style={{ color: x.is_open ? col?.main : "#8B6A66" }}>{REGION_LABEL[x.region_code]}</b>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${x.is_open ? "bg-[#E3F1E4] text-[#2F6B3A]" : "bg-[#EEE9E4] text-[#8A7F77]"}`}>{x.is_open ? "모집 중" : "닫힘"}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-[#EFE3DC]">
                          <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (n / Math.max(1, x.capacity)) * 100)}%`, background: col?.main }} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-[#6A4A4C]">
                          <span>신청 {n} / 정원 {x.capacity}</span>
                          {!past && (
                            <form action={toggleSlot}>
                              <input type="hidden" name="id" value={x.id} />
                              <input type="hidden" name="open" value={x.is_open ? "0" : "1"} />
                              <PendingButton className="rounded-md border border-[#E9DCD3] bg-white px-2 py-0.5 text-[11px]">{x.is_open ? "닫기" : "열기"}</PendingButton>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">식당</h2>
        <p className="mb-3 text-xs text-[#8B6A66]">
          리뷰 평점이 좋고 예약 가능한 곳을 기준으로 확보해요(FAQ Q9). 테이블이 확정되면 알레르기 메뉴가 있는 식당은 빼고, 비선호 음식이 겹치는 만큼 감점한 뒤 평점순으로 자동 배정돼요.
          표시된 이름은 시연용 가상 식당이에요.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.entries(REGION_LABEL).map(([code, label]) => (
          <section key={code} className="rounded-xl border-t-4 bg-[#FBF7F0] p-3" style={{ borderColor: REGION_COLOR[code]?.main }}>
          <p className="mb-2 font-bold" style={{ color: REGION_COLOR[code]?.main }}>{label} <span className="text-xs font-normal text-[#8B6A66]">식당 {((venues ?? []) as Venue[]).filter((v) => v.region_code === code).length}곳</span></p>
          <div className="space-y-2">
          {((venues ?? []) as Venue[]).filter((v) => v.region_code === code).map((v) => {
            const used = v.venue_availability.filter((a) => nextSlotIds.has(a.slot_id) || a.tables_used > 0);
            return (
              <div key={v.id} className={`rounded-xl border px-4 py-3 ${v.is_active ? "border-[#E9DCD3] bg-white" : "border-dashed border-[#E9DCD3] opacity-60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{v.name}</p>
                  <form action={toggleVenue}>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="active" value={v.is_active ? "0" : "1"} />
                    <PendingButton className="rounded-lg border border-[#E9DCD3] px-2 py-0.5 text-xs">{v.is_active ? "사용 중지" : "다시 사용"}</PendingButton>
                  </form>
                </div>
                <p className="mt-0.5 text-xs text-[#6A4A4C]">{REGION_LABEL[v.region_code]} · ★ {v.rating ?? "-"} · {v.menu_tags.join(", ")}</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8B6A66]">
                  <span>배정 {used.reduce((a, b) => a + b.tables_used, 0)} / 수용 {used.reduce((a, b) => a + b.tables_total, 0)} 테이블</span>
                  <form action={setVenueCapacity} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={v.id} />
                    회차당
                    <input type="number" name="tables" min={1} max={10}
                           defaultValue={Math.max(1, ...v.venue_availability.filter((a) => nextSlotIds.has(a.slot_id)).map((a) => a.tables_total))}
                           className="w-12 rounded border border-[#E9DCD3] px-1 py-0.5 text-xs" />
                    테이블
                    <PendingButton className="rounded border border-[#E9DCD3] px-1.5 py-0.5 text-xs">모두 적용</PendingButton>
                  </form>
                </div>
                {/* 날짜·시간별 수용 (PRD §11 식당 재고) */}
                {(() => {
                  const open = list.filter((x) => x.is_open && x.region_code === v.region_code && x.starts_at > nowIso);
                  if (!open.length) return null;
                  return (
                    <details className="mt-1.5 text-[11px] text-[#6A4A4C]">
                      <summary className="cursor-pointer text-[#7A1F2B]">날짜별로 조정</summary>
                      <div className="mt-1 space-y-1">
                        {open.map((x) => {
                          const av = v.venue_availability.find((a) => a.slot_id === x.id);
                          return (
                            <form key={x.id} action={setSlotCapacity} className="flex items-center gap-1.5">
                              <input type="hidden" name="venue" value={v.id} /><input type="hidden" name="slot" value={x.id} />
                              <span className="w-32">{fmtDate(x.starts_at)}</span>
                              <span className="text-[#8B6A66]">배정 {av?.tables_used ?? 0} /</span>
                              <input type="number" name="tables" min={av?.tables_used ?? 0} max={10} defaultValue={av?.tables_total ?? 0}
                                     className="w-12 rounded border border-[#E9DCD3] px-1 py-0.5 text-xs" />
                              <span>테이블</span>
                              <PendingButton className="rounded border border-[#E9DCD3] px-1.5 py-0.5 text-xs">저장</PendingButton>
                            </form>
                          );
                        })}
                      </div>
                    </details>
                  );
                })()}
              </div>
            );
          })}
          </div>
          </section>
          ))}
        </div>
        <details className="mt-4 rounded-xl border border-dashed border-[#E9DCD3] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-[#7A1F2B]">+ 식당 추가</summary>
          <form action={createVenue} className="mt-3 grid gap-2 text-sm md:grid-cols-3">
            <input required name="name" placeholder="식당 이름" className="rounded-lg border border-[#E9DCD3] px-2 py-1.5" />
            <select name="region" className="rounded-lg border border-[#E9DCD3] px-2 py-1.5">
              {Object.entries(REGION_LABEL).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
            <input required name="address" placeholder="주소" className="rounded-lg border border-[#E9DCD3] px-2 py-1.5" />
            <input name="map_url" placeholder="지도 링크 (선택)" className="rounded-lg border border-[#E9DCD3] px-2 py-1.5" />
            <input name="price_range" placeholder="가격대 예: 2~3만원" className="rounded-lg border border-[#E9DCD3] px-2 py-1.5" />
            <div className="flex gap-2">
              <input name="rating" type="number" step="0.1" min="0" max="5" placeholder="평점" className="w-20 rounded-lg border border-[#E9DCD3] px-2 py-1.5" />
              <input name="tables" type="number" min="1" defaultValue={2} title="회차당 테이블" className="w-20 rounded-lg border border-[#E9DCD3] px-2 py-1.5" />
              <span className="self-center text-xs text-[#8B6A66]">회차당 테이블</span>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-3 text-xs text-[#6A4A4C]">
              <span>메뉴 특징(알레르기·비선호 배정 제외용):</span>
              {DISLIKES.map((t) => <label key={t} className="flex items-center gap-1"><input type="checkbox" name="tags" value={t} className="accent-[#7A1F2B]" />{t}</label>)}
              {ALLERGIES.map((t) => <label key={t} className="flex items-center gap-1"><input type="checkbox" name="tags" value={t} className="accent-[#7A1F2B]" />{t}</label>)}
            </div>
            <div className="md:col-span-3"><PendingButton className="rounded-lg bg-[#7A1F2B] px-3 py-1.5 text-sm text-white">식당 추가</PendingButton></div>
          </form>
        </details>
      </Card>
    </div>
  );
}

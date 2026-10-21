import { Badge, Card } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { requireAdmin } from "@/lib/admin";
import { REGION_LABEL, fmtDate, fmtDeadline } from "@/lib/labels";
import { createSlot, createVenue, setVenueCapacity, toggleSlot, toggleVenue } from "../actions";
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
        <h1 className="mb-1 text-lg font-bold">회차</h1>
        <p className="mb-3 text-xs text-[#8B6A66]">매칭이 실행된 회차는 자동으로 닫혀요. 식당 사정 등으로 특정 회차를 미리 닫을 수도 있어요.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-[#8B6A66]"><tr><th className="py-2">일시</th><th>지역</th><th>정원</th><th>신청 마감·자동 매칭</th><th>상태</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-[#EFE3DC]">
                  <td className="py-2">{fmtDate(s.starts_at)}</td>
                  <td>{REGION_LABEL[s.region_code]}</td>
                  <td>{s.capacity}명</td>
                  <td className="text-xs">{fmtDeadline(s.apply_deadline)}</td>
                  <td><Badge tone={s.is_open ? "ok" : "muted"}>{s.is_open ? "모집 중" : "닫힘"}</Badge></td>
                  <td className="text-right">
                    <form action={toggleSlot}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="open" value={s.is_open ? "0" : "1"} />
                      <PendingButton className="rounded-lg border border-[#E9DCD3] px-2.5 py-1 text-xs">{s.is_open ? "닫기" : "열기"}</PendingButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">식당</h2>
        <p className="mb-3 text-xs text-[#8B6A66]">
          리뷰 평점이 좋고 예약 가능한 곳을 기준으로 확보해요(FAQ Q9). 테이블이 확정되면 알레르기 메뉴가 있는 식당은 빼고, 비선호 음식이 겹치는 만큼 감점한 뒤 평점순으로 자동 배정돼요.
          표시된 이름은 시연용 가상 식당이에요.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {((venues ?? []) as Venue[]).map((v) => {
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
                    <PendingButton className="rounded border border-[#E9DCD3] px-1.5 py-0.5 text-xs">저장</PendingButton>
                  </form>
                </div>
              </div>
            );
          })}
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

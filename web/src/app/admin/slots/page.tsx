import { Badge, Card } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { requireAdmin } from "@/lib/admin";
import { REGION_LABEL, fmtDate, fmtDeadline } from "@/lib/labels";
import { toggleSlot, toggleVenue } from "../actions";

type Slot = { id: string; starts_at: string; region_code: string; is_open: boolean; apply_deadline: string; capacity: number };
type Venue = { id: string; name: string; region_code: string; rating: number | null; menu_tags: string[]; is_active: boolean; is_reservable: boolean;
  venue_availability: { slot_id: string; tables_total: number; tables_used: number }[] };

// 회차 열기/닫기 + 식당 관리 (PRD ADM-06, ADM-07)
export default async function Slots() {
  const { supabase } = await requireAdmin();
  const [{ data: slots }, { data: venues }] = await Promise.all([
    supabase.from("event_slots").select("id, starts_at, region_code, is_open, apply_deadline, capacity").order("starts_at").order("region_code"),
    supabase.from("venues").select("id, name, region_code, rating, menu_tags, is_active, is_reservable, venue_availability(slot_id, tables_total, tables_used)").order("region_code").order("rating", { ascending: false }),
  ]);
  const list = (slots ?? []) as Slot[];
  const nextSlotIds = new Set(list.filter((s) => s.is_open).map((s) => s.id));

  return (
    <div className="space-y-5">
      <Card>
        <h1 className="mb-1 text-lg font-bold">회차</h1>
        <p className="mb-3 text-xs text-[#8B6A66]">매칭이 실행된 회차는 자동으로 닫혀요. 식당 사정 등으로 특정 회차를 미리 닫을 수도 있어요.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-[#8B6A66]"><tr><th className="py-2">일시</th><th>지역</th><th>신청 마감</th><th>상태</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-[#EFE3DC]">
                  <td className="py-2">{fmtDate(s.starts_at)}</td>
                  <td>{REGION_LABEL[s.region_code]}</td>
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
                <p className="mt-1 text-[11px] text-[#8B6A66]">
                  배정 {used.reduce((a, b) => a + b.tables_used, 0)} / 수용 {used.reduce((a, b) => a + b.tables_total, 0)} 테이블
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { AdminTitle, FilterChips, Pill, Stat, TableWrap, kstDate, shortDt, td, th, todayKst } from "@/components/admin-ui";
import { PendingButton } from "@/components/pending";
import { requireAdmin } from "@/lib/admin";
import { REGION_LABEL } from "@/lib/labels";
import { setAttendance } from "../actions";

type M = { table_id: string; user_id: string; attendance: string; checked_in_at: string | null; canceled_at: string | null;
  profiles: { name: string } | null; dining_tables: { status: string; event_slots: { starts_at: string; region_code: string } | null; venues: { name: string } | null } | null };

const ATT: Record<string, [string, "ok" | "warn" | "wait" | "muted" | "info"]> = {
  SCHEDULED: ["참석 예정", "muted"], ATTENDED: ["참석", "ok"], CANCELED_EARLY: ["사전 취소", "info"], CANCELED_LATE: ["당일 취소", "warn"], NO_SHOW: ["노쇼", "warn"],
};

// PRD §11 참석 관리: 체크인, 사전 취소, 당일 취소와 노쇼 후보 확인
export default async function Attendance({ searchParams }: { searchParams: Promise<{ date?: string; only?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("table_members")
    .select("table_id, user_id, attendance, checked_in_at, canceled_at, profiles(name), dining_tables(status, event_slots(starts_at, region_code), venues(name))")
    .limit(5000);
  const all = ((data ?? []) as unknown as M[]).filter((m) => m.dining_tables?.status === "CONFIRMED" && m.dining_tables.event_slots);
  const dates = [...new Set(all.map((m) => kstDate(m.dining_tables!.event_slots!.starts_at)))].sort();
  const date = sp.date ?? [...dates].reverse().find((d) => d <= todayKst()) ?? dates[0];
  const now = new Date().toISOString();
  const isCandidate = (m: M) => m.attendance === "SCHEDULED" && !m.checked_in_at && m.dining_tables!.event_slots!.starts_at < now;
  let list = all.filter((m) => kstDate(m.dining_tables!.event_slots!.starts_at) === date);
  const day = list;
  if (sp.only === "candidates") list = list.filter(isCandidate);
  if (sp.only === "cancel") list = list.filter((m) => m.attendance.startsWith("CANCELED"));
  list.sort((a, b) => a.table_id.localeCompare(b.table_id));
  const c = (f: (m: M) => boolean) => day.filter(f).length;

  return (
    <div className="space-y-4">
      <AdminTitle title="참석 관리" desc="참가자가 앱에서 체크인하면 자동으로 참석 처리돼요. 모임이 시작됐는데 체크인이 없는 사람만 '노쇼 후보'로 보여요. 확인 후 참석 또는 노쇼로 확정하세요(노쇼는 벌점 규칙 자동 적용)." />
      <FilterChips base="/admin/attendance" param="date" current={date} keep={{ only: sp.only }} options={dates.map((d) => [d, d] as [string, string])} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="배치 인원" value={day.length} />
        <Stat label="체크인·참석" value={c((m) => m.attendance === "ATTENDED")} tone="ok" />
        <Stat label="사전 취소" value={c((m) => m.attendance === "CANCELED_EARLY")} />
        <Stat label="당일 취소" value={c((m) => m.attendance === "CANCELED_LATE")} tone={c((m) => m.attendance === "CANCELED_LATE") ? "warn" : undefined} />
        <Stat label="노쇼 후보 / 노쇼" value={`${c(isCandidate)} / ${c((m) => m.attendance === "NO_SHOW")}`} tone={c(isCandidate) ? "warn" : undefined} />
      </div>
      <FilterChips base="/admin/attendance" param="only" current={sp.only} keep={{ date }}
                   options={[["", "전체"], ["candidates", "노쇼 후보만"], ["cancel", "취소만"]]} />
      <TableWrap min={820}>
        <thead><tr><th className={th}>테이블</th><th className={th}>이름</th><th className={th}>상태</th><th className={th}>체크인</th><th className={th}>취소 시각</th><th className={th}></th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td className={td} colSpan={6}>해당하는 사람이 없어요.</td></tr>}
          {list.map((m) => {
            const s = m.dining_tables!.event_slots!;
            const cand = isCandidate(m);
            return (
              <tr key={`${m.table_id}${m.user_id}`}>
                <td className={`${td} text-xs`}>
                  <Link href={`/admin/tables?table=${m.table_id}`} className="underline">{REGION_LABEL[s.region_code]} · {m.dining_tables!.venues?.name?.replace(/^\[샘플\]\s*/, "") ?? "식당 미배정"}</Link>
                </td>
                <td className={td}>{m.profiles?.name}</td>
                <td className={td}>{cand ? <Pill tone="wait">노쇼 후보</Pill> : <Pill tone={ATT[m.attendance]?.[1]}>{ATT[m.attendance]?.[0] ?? m.attendance}</Pill>}</td>
                <td className={`${td} text-xs`}>{shortDt(m.checked_in_at)}</td>
                <td className={`${td} text-xs`}>{shortDt(m.canceled_at)}</td>
                <td className={td}>
                  {cand && (
                    <form action={setAttendance} className="flex justify-end gap-1">
                      <input type="hidden" name="table" value={m.table_id} />
                      <input type="hidden" name="user" value={m.user_id} />
                      <PendingButton name="status" value="ATTENDED" className="rounded-lg border border-[#E9DCD3] px-2 py-0.5 text-xs">참석 확인</PendingButton>
                      <PendingButton name="status" value="NO_SHOW" className="rounded-lg bg-[#A2412A] px-2 py-0.5 text-xs text-white">노쇼 확정</PendingButton>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </div>
  );
}

import Link from "next/link";
import { AdminTitle, FilterChips, Pill, Stat, kstDate, shortDt, todayKst } from "@/components/admin-ui";
import { REGION_COLOR } from "../region-map";
import { PendingButton } from "@/components/pending";
import { requireAdmin } from "@/lib/admin";
import { REGION_LABEL } from "@/lib/labels";
import { setAttendance } from "../actions";

type M = { table_id: string; user_id: string; attendance: string; checked_in_at: string | null; canceled_at: string | null;
  profiles: { name: string; gender: string; birth_year: number } | null; dining_tables: { status: string; event_slots: { starts_at: string; region_code: string } | null; venues: { name: string } | null } | null };

const ATT: Record<string, [string, "ok" | "warn" | "wait" | "muted" | "info"]> = {
  SCHEDULED: ["참석 예정", "muted"], ATTENDED: ["참석", "ok"], CANCELED_EARLY: ["사전 취소", "info"], CANCELED_LATE: ["당일 취소", "warn"], NO_SHOW: ["노쇼", "warn"],
};

// PRD §11 참석 관리: 체크인, 사전 취소, 당일 취소와 노쇼 후보 확인
export default async function Attendance({ searchParams }: { searchParams: Promise<{ date?: string; region?: string; only?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("table_members")
    .select("table_id, user_id, attendance, checked_in_at, canceled_at, profiles(name, gender, birth_year), dining_tables(status, event_slots(starts_at, region_code), venues(name))")
    .limit(5000);
  const all = ((data ?? []) as unknown as M[]).filter((m) => m.dining_tables?.status === "CONFIRMED" && m.dining_tables.event_slots);
  const dates = [...new Set(all.map((m) => kstDate(m.dining_tables!.event_slots!.starts_at)))].sort();
  const date = sp.date ?? [...dates].reverse().find((d) => d <= todayKst()) ?? dates[0];
  const now = new Date().toISOString();
  const isCandidate = (m: M) => m.attendance === "SCHEDULED" && !m.checked_in_at && m.dining_tables!.event_slots!.starts_at < now;
  const day = all.filter((m) => kstDate(m.dining_tables!.event_slots!.starts_at) === date);
  const c = (xs: M[], f: (m: M) => boolean) => xs.filter(f).length;
  const regionOf = (m: M) => m.dining_tables!.event_slots!.region_code;
  const sel = sp.region;
  // 대시보드에서 "노쇼 후보"·"당일 취소"를 누르고 들어오면 지역 상관없이 해당 사람만 바로 보여 줌
  const onlyF = sp.only === "candidates" ? isCandidate : sp.only === "cancel" ? (m: M) => m.attendance.startsWith("CANCELED") : null;
  const list = onlyF ? day.filter((m) => onlyF(m) && (!sel || regionOf(m) === sel)) : sel ? day.filter((m) => regionOf(m) === sel) : [];
  // 테이블별로 묶기
  const byTable = new Map<string, M[]>();
  for (const m of list) byTable.set(m.table_id, [...(byTable.get(m.table_id) ?? []), m]);

  return (
    <div className="space-y-5 text-base">
      <AdminTitle title="참석 관리" desc="체크인하면 자동으로 참석 처리돼요. 모임이 시작됐는데 체크인이 없는 사람만 '노쇼 후보'로 보여요. 확인 후 참석 또는 노쇼로 확정하세요(노쇼는 벌점 자동 적용)." />
      <FilterChips base="/admin/attendance" param="date" current={date} keep={{ region: sel }} options={dates.map((d) => [d, d] as [string, string])} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="배치 인원" value={day.length} />
        <Stat label="체크인·참석" value={c(day, (m) => m.attendance === "ATTENDED")} tone="ok" />
        <Stat label="사전 취소" value={c(day, (m) => m.attendance === "CANCELED_EARLY")} />
        <Stat label="당일 취소" value={c(day, (m) => m.attendance === "CANCELED_LATE")} tone={c(day, (m) => m.attendance === "CANCELED_LATE") ? "warn" : undefined} />
        <Stat label="노쇼 후보 / 노쇼" value={`${c(day, isCandidate)} / ${c(day, (m) => m.attendance === "NO_SHOW")}`} tone={c(day, isCandidate) ? "warn" : undefined} />
      </div>

      {/* 지역 4칸: 누르면 아래에 명단 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(REGION_LABEL).map(([code, label]) => {
          const xs = day.filter((m) => regionOf(m) === code);
          const col = REGION_COLOR[code];
          const active = sel === code;
          const tables = new Set(xs.map((m) => m.table_id)).size;
          return (
            <Link key={code} href={`/admin/attendance?date=${date}${active ? "" : `&region=${code}`}`}
                  className="rounded-2xl border-2 bg-white p-4 transition hover:shadow-md"
                  style={{ borderColor: active ? col.main : "transparent", boxShadow: "0 1px 3px rgba(74,52,38,0.08)" }}>
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold" style={{ color: col.main }}>{label}</span>
                <span className="text-sm text-[#8B6A66]">{active ? "접기 ▲" : "명단 보기 ▼"}</span>
              </div>
              <p className="mt-1 text-sm text-[#6A4A4C]">테이블 {tables}개 · {xs.length}명</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
                <span className="rounded-full px-2.5 py-0.5" style={{ background: col.soft, color: col.main }}>참석 {c(xs, (m) => m.attendance === "ATTENDED")}</span>
                <span className="rounded-full bg-[#EEE9E4] px-2.5 py-0.5 text-[#6A5F57]">예정 {c(xs, (m) => m.attendance === "SCHEDULED" && !isCandidate(m))}</span>
                {c(xs, (m) => m.attendance.startsWith("CANCELED")) > 0 && <span className="rounded-full bg-[#DDE9F7] px-2.5 py-0.5 text-[#2C5687]">취소 {c(xs, (m) => m.attendance.startsWith("CANCELED"))}</span>}
                {c(xs, isCandidate) > 0 && <span className="rounded-full bg-[#FDEFC8] px-2.5 py-0.5 text-[#8A5B00]">노쇼 후보 {c(xs, isCandidate)}</span>}
                {c(xs, (m) => m.attendance === "NO_SHOW") > 0 && <span className="rounded-full bg-[#FCEDE8] px-2.5 py-0.5 text-[#A2412A]">노쇼 {c(xs, (m) => m.attendance === "NO_SHOW")}</span>}
              </div>
            </Link>
          );
        })}
      </div>

      {onlyF && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#FDEFC8] px-4 py-2.5 text-sm text-[#8A5B00]">
          <b>{sp.only === "candidates" ? "노쇼 후보만" : "취소한 사람만"}</b> 보고 있어요 ({list.length}명)
          <Link href={`/admin/attendance?date=${date}`} className="ml-auto underline">전체 보기</Link>
        </div>
      )}
      {!sel && !onlyF && <p className="text-center text-sm text-[#8B6A66]">지역 칸을 누르면 테이블별 명단이 보여요.</p>}

      {(sel || onlyF) && (
        <div className="grid gap-3 md:grid-cols-2">
          {[...byTable.entries()].map(([tid, ms], i) => (
            <div key={tid} className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
              <div className="mb-2 flex items-center justify-between">
                <Link href={`/admin/tables?table=${tid}`} className="font-bold underline-offset-2 hover:underline" style={{ color: REGION_COLOR[regionOf(ms[0])]?.main }}>
                  {sel ? `테이블 ${i + 1}` : REGION_LABEL[regionOf(ms[0])]} · {ms[0].dining_tables!.venues?.name?.replace(/^\[샘플\]\s*/, "") ?? "식당 미배정"}
                </Link>
                <span className="text-sm text-[#8B6A66]">
                  {ms.length}명 · <span className="text-[#C2185B]">여 {ms.filter((m) => m.profiles?.gender === "F").length}</span>{" "}
                  <span className="text-[#1565C0]">남 {ms.filter((m) => m.profiles?.gender === "M").length}</span>
                </span>
              </div>
              <ul className="divide-y divide-[#F4ECE6]">
                {ms.map((m) => {
                  const cand = isCandidate(m);
                  return (
                    <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="w-16 font-medium">{m.profiles?.name}</span>
                      <span className={`w-20 whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs font-semibold ${m.profiles?.gender === "F" ? "bg-[#FCE4EC] text-[#C2185B]" : "bg-[#E3F2FD] text-[#1565C0]"}`}>
                        {m.profiles?.gender === "F" ? "여" : "남"}{m.profiles ? ` · ${new Date().getFullYear() - m.profiles.birth_year}세` : ""}
                      </span>
                      {cand ? <Pill tone="wait">노쇼 후보</Pill> : <Pill tone={ATT[m.attendance]?.[1]}>{ATT[m.attendance]?.[0] ?? m.attendance}</Pill>}
                      <span className="text-sm text-[#8B6A66]">
                        {m.checked_in_at ? `체크인 ${shortDt(m.checked_in_at)}` : m.canceled_at ? `취소 ${shortDt(m.canceled_at)}` : ""}
                      </span>
                      {cand && (
                        <form action={setAttendance} className="ml-auto flex gap-1">
                          <input type="hidden" name="table" value={m.table_id} />
                          <input type="hidden" name="user" value={m.user_id} />
                          <PendingButton name="status" value="ATTENDED" className="rounded-lg border border-[#E9DCD3] px-2.5 py-1 text-sm">참석 확인</PendingButton>
                          <PendingButton name="status" value="NO_SHOW" className="rounded-lg bg-[#A2412A] px-2.5 py-1 text-sm text-white">노쇼 확정</PendingButton>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {byTable.size === 0 && <p className="text-sm text-[#8B6A66]">해당하는 사람이 없어요.</p>}
        </div>
      )}
    </div>
  );
}

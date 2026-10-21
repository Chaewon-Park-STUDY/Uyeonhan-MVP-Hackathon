// 핵심 지표 (OT "제품의 성과는 매칭 품질과 운영 자동화를 함께 측정합니다" 12개 지표)
// 획득·전환 / 매칭 품질 / 반복 참여 / 운영 효율 — 누적 기준, 분모가 0이면 "-"
import type { requireAdmin } from "@/lib/admin";
type SupabaseClient = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

type App = { id: string; user_id: string; application_status: string; payment_status: string; match_status: string; submitted_at: string | null; created_at: string };
type Mem = { user_id: string; table_id: string; attendance: string; reallocation_count: number; dining_tables: { status: string; event_slots: { starts_at: string } | null } | null };

const pct = (a: number, b: number) => (b > 0 ? `${Math.min(100, Math.max(0, Math.round((a / b) * 100)))}%` : "-");

export async function Metrics({ supabase }: { supabase: SupabaseClient }) {
  const [{ data: a }, { data: m }, { data: res }, { data: fb }, { data: exc }, { data: tbl }] = await Promise.all([
    supabase.from("applications").select("id, user_id, application_status, payment_status, match_status, submitted_at, created_at").limit(10000),
    supabase.from("table_members").select("user_id, table_id, attendance, reallocation_count, dining_tables(status, event_slots(starts_at))").limit(10000),
    supabase.from("match_resolutions").select("application_id").limit(10000),
    supabase.from("feedback").select("user_id, created_at").limit(10000),
    supabase.from("exception_cases").select("table_id, application_id, status, created_at, resolved_at").limit(10000),
    supabase.from("dining_tables").select("id, status").eq("status", "CONFIRMED").limit(10000),
  ]);
  const apps = (a ?? []) as App[];
  const mems = ((m ?? []) as unknown as Mem[]).filter((x) => x.dining_tables?.status === "CONFIRMED");
  const now = new Date().toISOString();
  const past = mems.filter((x) => (x.dining_tables?.event_slots?.starts_at ?? now) < now);   // 이미 열린 모임
  const excs = (exc ?? []) as { table_id: string | null; application_id: string | null; status: string; created_at: string; resolved_at: string | null }[];

  // 획득·전환
  const created = apps.length;
  const submitted = apps.filter((x) => x.application_status !== "DRAFT");
  const paid = submitted.filter((x) => x.payment_status === "PAID" || x.payment_status.startsWith("REFUND"));
  const attended = past.filter((x) => x.attendance === "ATTENDED");

  // 매칭 품질
  const confirmed = new Set(mems.map((x) => x.user_id + "|" + x.table_id)).size;
  const failedIds = new Set(((res ?? []) as { application_id: string }[]).map((r) => r.application_id));
  const realloc = mems.filter((x) => x.reallocation_count > 0).length;
  const canceled = submitted.filter((x) => x.application_status === "CANCELED").length
    + mems.filter((x) => x.attendance === "CANCELED_EARLY" || x.attendance === "CANCELED_LATE").length;

  // 반복 참여
  const attendCount = new Map<string, number>();
  for (const x of attended) attendCount.set(x.user_id, (attendCount.get(x.user_id) ?? 0) + 1);
  const repeaters = [...attendCount.values()].filter((n) => n >= 2).length;
  const fbs = (fb ?? []) as { user_id: string; created_at: string }[];
  const fbUsers = new Map<string, string>();
  for (const f of fbs) if (!fbUsers.has(f.user_id) || f.created_at < fbUsers.get(f.user_id)!) fbUsers.set(f.user_id, f.created_at);
  const fbAmongAttended = [...attendCount.keys()].filter((u) => fbUsers.has(u)).length;
  const nextApplied = [...fbUsers.entries()].filter(([u, t]) => submitted.some((x) => x.user_id === u && (x.submitted_at ?? x.created_at) > t)).length;

  // 운영 효율
  const tables = (tbl ?? []).length;
  const confirmedIds = new Set(((tbl ?? []) as { id: string }[]).map((t) => t.id));
  const excTables = new Set(excs.map((e) => e.table_id).filter((id): id is string => !!id && confirmedIds.has(id))).size;   // 확정 테이블 중 처리대기가 있었던 것만
  const resolved = excs.filter((e) => e.resolved_at);
  const avgMin = resolved.length
    ? Math.round(resolved.reduce((s, e) => s + (new Date(e.resolved_at!).getTime() - new Date(e.created_at).getTime()), 0) / resolved.length / 60e3) : null;
  const avgText = avgMin == null ? "-" : avgMin >= 60 ? `${Math.floor(avgMin / 60)}시간 ${avgMin % 60}분` : `${avgMin}분`;

  const groups: { title: string; color: string; items: [string, string, string][] }[] = [
    { title: "획득·전환", color: "#7A1F2B", items: [
      ["신청 완료율", pct(submitted.length, created), `작성 ${created} 중 제출 ${submitted.length}`],
      ["결제 전환율", pct(paid.length, submitted.length), `제출 ${submitted.length} 중 결제 ${paid.length}`],
      ["실제 참가 전환율", pct(attended.length, past.length), `지난 모임 배정 ${past.length} 중 참석 ${attended.length}`],
    ] },
    { title: "매칭 품질", color: "#2F6B3A", items: [
      ["매칭 성공률", pct(confirmed, confirmed + failedIds.size), `확정 ${confirmed} · 실패 ${failedIds.size}`],
      ["재배치 성공률", pct(realloc, realloc + failedIds.size), `다시 맞춰 자리 찾음 ${realloc}`],
      ["취소율", pct(canceled, submitted.length), `신청 취소·좌석 취소 ${canceled}`],
    ] },
    { title: "반복 참여", color: "#3B6EA8", items: [
      ["재방문율", pct(repeaters, attendCount.size), `참석자 ${attendCount.size}명 중 2회 이상 ${repeaters}명`],
      ["피드백 응답률", pct(fbAmongAttended, attendCount.size), `참석자 ${attendCount.size}명 중 피드백 ${fbAmongAttended}명`],
      ["다음 일정 전환율", pct(nextApplied, fbUsers.size), `피드백 후 다시 신청 ${nextApplied}명`],
    ] },
    { title: "운영 효율", color: "#B45309", items: [
      ["자동 확정률", pct(tables - excTables, tables), `확정 테이블 ${tables} 중 운영자 손 안 댐 ${Math.max(0, tables - excTables)}`],
      ["운영자 개입률", pct(excs.length, submitted.length), `처리대기 ${excs.length}건 / 신청 ${submitted.length}건`],
      ["처리 시간 (평균)", avgText, `처리대기 건이 해결되기까지 · ${resolved.length}건 기준`],
    ] },
  ];

  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">핵심 지표</h2>
        <p className="text-xs text-[#8B6A66]">지금까지 누적 · 모임이 끝나고 체크인·피드백이 쌓이면 반복 참여 지표가 채워져요</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((g) => (
          <div key={g.title} className="rounded-xl border border-[#F1E7E1] p-3">
            <p className="mb-2 text-sm font-bold" style={{ color: g.color }}>{g.title}</p>
            <ul className="space-y-2">
              {g.items.map(([label, value, sub]) => (
                <li key={label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-[#2E1B1E]">{label}</span>
                    <span className="text-lg font-bold tabular-nums" style={{ color: g.color }}>{value}</span>
                  </div>
                  <p className="text-[11px] text-[#8B6A66]">{sub}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

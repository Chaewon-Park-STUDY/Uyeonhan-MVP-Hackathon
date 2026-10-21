import Link from "next/link";
import { AdminTitle, Pill, Stat, TableWrap, kstDate, shortDt, td, th } from "@/components/admin-ui";
import { requireAdmin } from "@/lib/admin";
import { REGION_LABEL } from "@/lib/labels";

const CHOICE: Record<string, string> = { MOVE_DATE: "다른 날짜로 이동", MOVE_REGION: "다른 지역으로 이동", KEEP_PASS: "이용권 보관", REFUND: "환불" };

type Run = { id: string; run_key: string; algorithm_version: string; started_at: string; finished_at: string | null; error: string | null;
  stats: Record<string, number | null | Record<string, number>> | null };
type Failed = { id: string; match_status: string; profiles: { name: string };
  match_resolutions: { choice: string | null; resolved_at: string | null; offered_slots: string[]; created_at: string; reason: string | null } | null;
  application_slots: { event_slots: { starts_at: string; region_code: string } | null }[] };
type Moved = { user_id: string; reallocation_count: number; placement_reason: string | null; profiles: { name: string };
  dining_tables: { status: string; event_slots: { starts_at: string; region_code: string } | null } | null };

// PRD §11 자동 매칭 모니터: 실행 결과, 재배치 내역, 자동 확정 테이블, 매칭 실패자
export default async function Runs() {
  const { supabase } = await requireAdmin();
  const [{ data: runs }, { data: failed }, { data: moved }] = await Promise.all([
    supabase.from("match_runs").select("id, run_key, algorithm_version, started_at, finished_at, error, stats").order("started_at", { ascending: false }).limit(20),
    supabase.from("applications").select("id, match_status, profiles(name), match_resolutions(choice, resolved_at, offered_slots, created_at, reason), application_slots(event_slots(starts_at, region_code))")
      .in("match_status", ["ALTERNATIVE_OFFERED", "NO_MATCH"]).order("updated_at", { ascending: false }).limit(100),
    supabase.from("table_members").select("user_id, reallocation_count, placement_reason, profiles(name), dining_tables(status, event_slots(starts_at, region_code))")
      .gt("reallocation_count", 0).limit(100),
  ]);
  const list = (runs ?? []) as Run[];
  const fails = (failed ?? []) as unknown as Failed[];
  const moves = (moved ?? []) as unknown as Moved[];
  const num = (r: Run, k: string) => (typeof r.stats?.[k] === "number" ? (r.stats[k] as number) : 0);
  const totalApps = list.reduce((a, r) => a + num(r, "applications"), 0);
  const totalPlaced = list.reduce((a, r) => a + num(r, "placed"), 0);
  const choice = (c: string | null) => (c && CHOICE[c]) || "참가자 선택 대기";

  return (
    <div className="space-y-5">
      <AdminTitle title="자동 매칭 모니터" desc="회차 마감 시각마다 자동으로 실행된 매칭 결과예요. 같은 날짜는 한 번만 실행돼요(중복 실행 방지)." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="실행 횟수" value={list.length} />
        <Stat label="자동 배치 성공률" value={totalApps ? `${Math.round((totalPlaced / totalApps) * 100)}%` : "-"} tone="ok" />
        <Stat label="재배치 성공률" value={(() => {
          const tried = list.reduce((a, r) => a + num(r, "reallocated_placed") + num(r, "failed") + num(r, "unmatched"), 0);
          const ok = list.reduce((a, r) => a + num(r, "reallocated_placed"), 0);
          return tried ? `${Math.round((ok / tried) * 100)}% (${ok}명)` : "-";
        })()} />
        <Stat label="매칭 실패 (대안 제시)" value={fails.length} tone={fails.length ? "warn" : undefined} />
      </div>

      <section>
        <h2 className="mb-2 font-semibold">실행 기록</h2>
        <TableWrap min={860}>
          <thead><tr><th className={th}>모임일</th><th className={th}>실행 시각</th><th className={th}>대상</th><th className={th}>확정 테이블</th>
            <th className={th}>배치</th><th className={th}>재배치로 배치</th><th className={th}>점수 미달 해체→구제</th><th className={th}>실패</th><th className={th}>예상 만족도</th><th className={th}>상태</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td className={td} colSpan={10}>아직 실행 기록이 없어요.</td></tr>}
            {list.map((r) => (
              <tr key={r.id}>
                <td className={td}><Link href={`/admin/tables?date=${r.run_key}`} className="font-semibold text-[#7A1F2B] underline">{r.run_key}</Link></td>
                <td className={`${td} text-xs`}>{shortDt(r.finished_at ?? r.started_at)}</td>
                <td className={td}>{num(r, "applications")}명</td>
                <td className={td}>{num(r, "tables_confirmed")}개</td>
                <td className={td}>{num(r, "placed")}명</td>
                <td className={td}>{num(r, "reallocated_placed")}명</td>
                <td className={td}>{num(r, "dissolved_low_score")} → {num(r, "dissolved_rescued")}</td>
                <td className={td}>{num(r, "failed") || num(r, "unmatched")}명</td>
                <td className={td}>{r.stats?.mean_pred != null ? `${r.stats.mean_pred}점` : "-"}</td>
                <td className={td}>{r.error ? <Pill tone="warn">오류</Pill> : r.finished_at ? <Pill tone="ok">완료</Pill> : <Pill tone="wait">실행 중</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">재배치 내역 <span className="text-sm font-normal text-[#8B6A66]">처음 조합에서 빠져 다른 테이블로 옮겨 확정된 사람</span></h2>
          <TableWrap min={420}>
            <thead><tr><th className={th}>이름</th><th className={th}>최종 배치</th><th className={th}>재배치</th><th className={th}>사유</th></tr></thead>
            <tbody>
              {moves.length === 0 && <tr><td className={td} colSpan={4}>재배치된 사람이 없어요.</td></tr>}
              {moves.map((m, i) => (
                <tr key={i}>
                  <td className={td}>{m.profiles.name}</td>
                  <td className={`${td} text-xs`}>{m.dining_tables?.event_slots ? `${kstDate(m.dining_tables.event_slots.starts_at).slice(5)} ${REGION_LABEL[m.dining_tables.event_slots.region_code]}` : "-"}</td>
                  <td className={td}>{m.reallocation_count}회</td>
                  <td className={`${td} text-xs text-[#6A4A4C]`}>{m.placement_reason || "-"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">매칭 실패자 <span className="text-sm font-normal text-[#8B6A66]">다른 일정·이용권 보관·환불 중 선택</span></h2>
          <TableWrap min={420}>
            <thead><tr><th className={th}>이름</th><th className={th}>희망 회차</th><th className={th}>실패 시각 · 사유</th><th className={th}>제안</th><th className={th}>처리</th></tr></thead>
            <tbody>
              {fails.length === 0 && <tr><td className={td} colSpan={5}>매칭 실패자가 없어요.</td></tr>}
              {fails.map((f) => (
                <tr key={f.id}>
                  <td className={td}>{f.profiles.name}</td>
                  <td className={`${td} text-xs`}>{f.application_slots.filter((s) => s.event_slots).map((s, i) => (
                    <div key={i}>{kstDate(s.event_slots!.starts_at).slice(5)} {REGION_LABEL[s.event_slots!.region_code]}</div>))}</td>
                  <td className={`${td} text-xs`}>{shortDt(f.match_resolutions?.created_at)}<div className="text-[#8B6A66]">{f.match_resolutions?.reason ?? "-"}</div></td>
                  <td className={td}>{f.match_resolutions?.offered_slots.length ?? 0}개</td>
                  <td className={td}>
                    <Pill tone={f.match_resolutions?.resolved_at ? "ok" : "wait"}>{f.match_resolutions?.resolved_at ? choice(f.match_resolutions.choice) : "선택 대기"}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      </div>
    </div>
  );
}

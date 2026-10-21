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
// 실패 사유 분류 ("분류: 설명")
const CAT_STYLE: Record<string, string> = {
  "인원 부족": "border-[#2F6FB3] bg-[#DBE8F6] text-[#1F4F86]",
  "나이 조건": "border-[#C98A12] bg-[#F8EBCB] text-[#7A5306]",
  "제외 관계": "border-[#A2412A] bg-[#FCEDE8] text-[#A2412A]",
  "만족도 기준 미달": "border-[#7A5BB5] bg-[#ECE4F7] text-[#4F3A80]",
  "기타": "border-[#B7A3A0] bg-[#EEE9E4] text-[#6A5F57]",
};
const splitReason = (r?: string | null): [string, string] => {
  if (!r) return ["기타", "사유 기록 없음"];
  const i = r.indexOf(":");
  return i > 0 ? [r.slice(0, i).trim(), r.slice(i + 1).trim()] : ["기타", r];
};

export default async function Runs({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const sp = await searchParams;
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
  const catOf = (f: Failed) => splitReason(f.match_resolutions?.reason)[0];
  const cats = [...new Set(fails.map(catOf))];
  const shownFails = sp.reason ? fails.filter((f) => catOf(f) === sp.reason) : fails;
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
            <th className={th}>자리 배정</th><th className={th}>재배치로 배정</th><th className={th}>다시 짠 인원 → 자리 찾음</th><th className={th}>실패</th><th className={th}>예상 만족도</th><th className={th}>상태</th></tr></thead>
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
                <td className={td}>{num(r, "dissolved_low_score")}명 → {num(r, "dissolved_rescued")}명</td>
                <td className={td}>{num(r, "failed") || num(r, "unmatched")}명</td>
                <td className={td}>{r.stats?.mean_pred != null ? `${r.stats.mean_pred}점` : "-"}</td>
                <td className={td}>{r.error ? <Pill tone="warn">오류</Pill> : r.finished_at ? <Pill tone="ok">완료</Pill> : <Pill tone="wait">실행 중</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <ul className="mt-2 space-y-0.5 text-xs text-[#8B6A66]">
          <li>· <b>재배치로 배정</b>: 처음 고른 지역에 자리가 없어, 같은 날 다른 희망 지역이나 다른 희망 날짜로 옮겨 확정된 사람</li>
          <li>· <b>다시 짠 인원 → 자리 찾음</b>: 예상 만족도가 최소 점수보다 낮아 확정하지 않고 풀어 다시 짠 테이블의 인원, 그중 다른 테이블에 들어간 사람 수</li>
          <li>· <b>실패</b>: 어떤 테이블에도 못 들어가 다른 일정·이용권 보관·환불을 고르게 된 사람</li>
        </ul>
      </section>

      <div className="space-y-5">
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
          <h2 className="mb-2 font-semibold">매칭 실패자 <span className="text-sm font-normal text-[#8B6A66]">사유별로 골라 볼 수 있어요</span></h2>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[["", "전체", fails.length] as [string, string, number], ...cats.map((c) => [c, c, fails.filter((f) => catOf(f) === c).length] as [string, string, number])].map(([v, label, n]) => (
              <Link key={v || "all"} href={v ? `/admin/runs?reason=${encodeURIComponent(v)}` : "/admin/runs"}
                    className={`rounded-full px-3 py-1 text-sm ${(sp.reason ?? "") === v ? "bg-[#7A1F2B] text-white" : `border ${CAT_STYLE[label] ?? "border-[#E9DCD3] bg-white"}`}`}>
                {label} {n}
              </Link>
            ))}
          </div>
          <TableWrap min={760}>
            <thead><tr><th className={th}>이름</th><th className={th}>희망 회차</th><th className={th}>실패 사유</th><th className={th}>실패 시각</th><th className={th}>제안 회차</th><th className={th}>처리</th></tr></thead>
            <tbody>
              {shownFails.length === 0 && <tr><td className={td} colSpan={6}>해당하는 사람이 없어요.</td></tr>}
              {shownFails.map((f) => {
                const [cat, detail] = splitReason(f.match_resolutions?.reason);
                return (
                  <tr key={f.id}>
                    <td className={`${td} font-medium`}>{f.profiles.name}</td>
                    <td className={`${td} text-xs`}>{f.application_slots.filter((s) => s.event_slots).map((s, i) => (
                      <div key={i}>{kstDate(s.event_slots!.starts_at).slice(5)} {REGION_LABEL[s.event_slots!.region_code]}</div>))}</td>
                    <td className={td}>
                      <span className={`mr-1.5 inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${CAT_STYLE[cat] ?? "border-[#E9DCD3]"}`}>{cat}</span>
                      <span className="text-xs text-[#6A4A4C]">{detail}</span>
                    </td>
                    <td className={`${td} text-xs`}>{shortDt(f.match_resolutions?.created_at)}</td>
                    <td className={td}>{f.match_resolutions?.offered_slots.length ?? 0}개</td>
                    <td className={td}>
                      <Pill tone={f.match_resolutions?.resolved_at ? "ok" : "wait"}>{f.match_resolutions?.resolved_at ? choice(f.match_resolutions.choice) : "선택 대기"}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </section>
      </div>
    </div>
  );
}

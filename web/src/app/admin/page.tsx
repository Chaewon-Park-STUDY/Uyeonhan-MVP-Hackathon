import Link from "next/link";
import { Card } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { FEATURE_LABEL, callEngine, requireAdmin } from "@/lib/admin";
import { fmtDate } from "@/lib/labels";
import { runLearn, runMatch } from "./actions";

type Row = { run_date: string; slots: number; open_slots: number; apps_total: number; apps_paid: number; apps_pending: number;
  confirmed_tables: number; confirmed_people: number; offered: number; matched_at: string | null; match_run_at: string };
type Learn = { n_tables?: number; coef?: Record<string, number>; coef_sd?: Record<string, number>; status?: string; error?: string };
type Summary = { n_tables: number; n_feedback: number; avg_table: number | null; avg_convo: number | null; avg_venue: number | null;
  like_count: number; avoid_count: number; reports: number; no_shows: number };

const REPORT_URL = "https://github.com/Chaewon-Park-STUDY/Uyeonhan-MVP-Hackathon/blob/main/docs/reports/2026-10-20_thompson_simulation.md";

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: rows }, { count: openExc }, { data: demand }, { data: sum }, { data: settings }, learn] = await Promise.all([
    supabase.rpc("admin_overview"),
    supabase.from("exception_cases").select("id", { count: "exact", head: true }).eq("status", "OPEN"),
    supabase.rpc("admin_region_demand"),
    supabase.rpc("feedback_summary").maybeSingle<Summary>(),
    supabase.from("settings").select("key, value").in("key", ["matching", "region_expansion"]),
    callEngine("learn", { dry_run: "1" }) as Promise<Learn>,
  ]);
  const cfg = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value])) as Record<string, Record<string, unknown>>;
  const weights = (cfg.matching?.weights ?? {}) as Record<string, number>;
  const threshold = Number(cfg.region_expansion?.open_threshold ?? 8);
  const dates = (rows ?? []) as Row[];
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const next = dates.find((d) => d.run_date >= today) ?? dates[dates.length - 1];
  const result = sp.result ? (JSON.parse(sp.result) as { date: string; dry: boolean; out: Record<string, unknown> }) : null;

  return (
    <div className="space-y-5">
      {sp.msg && <p className="rounded-xl bg-[#FCEDE8] px-4 py-3 text-sm text-[#A2412A]">{sp.msg}</p>}
      {sp.learn && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">학습 결과: {sp.learn}</p>}
      {result && (
        <Card className="text-sm">
          <p className="font-semibold">{result.date} 매칭 {result.dry ? "미리보기(저장 안 함)" : "실행"} 결과</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-[#FBF1EC] p-3 text-xs">{JSON.stringify(result.out, null, 2)}</pre>
        </Card>
      )}

      {/* 핵심 숫자 */}
      {next && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label={`${next.run_date} 신청`} value={next.apps_total} sub={`결제 ${next.apps_paid} · 대기 ${next.apps_pending}`} />
          <Kpi label="확정 테이블" value={next.confirmed_tables} sub={`${next.confirmed_people}명 배치`} />
          <Kpi label="대체 회차 제안" value={next.offered} sub="미리 고른 선택지 자동 적용" />
          <Kpi label="처리할 예외" value={openExc ?? 0} sub="예외함에서 확인" href="/admin/exceptions" warn={(openExc ?? 0) > 0} />
          <Kpi label="피드백 평균 만족도" value={sum?.avg_table ?? "-"} sub={`${sum?.n_feedback ?? 0}건 · 신고 ${sum?.reports ?? 0}`} />
        </div>
      )}

      {/* 회차별 현황 + 매칭 실행 */}
      <Card>
        <h2 className="mb-3 font-semibold">회차별 현황</h2>
        <p className="mb-3 text-xs text-[#8B6A66]">매칭은 매시간 5분에 자동으로 확인해, 마감(화 24:00)이 지난 회차를 실행해요. 여기서는 미리 결과를 보거나 즉시 실행할 수 있어요.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-[#8B6A66]">
              <tr><th className="py-2">모임일</th><th>회차(열림)</th><th>신청</th><th>결제</th><th>확정</th><th>대체 제안</th><th>매칭</th><th></th></tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d.run_date} className="border-t border-[#EFE3DC]">
                  <td className="py-2.5 font-semibold">{d.run_date}</td>
                  <td>{d.slots} ({d.open_slots})</td>
                  <td>{d.apps_total}</td>
                  <td>{d.apps_paid}</td>
                  <td>{d.confirmed_tables}테이블 · {d.confirmed_people}명</td>
                  <td>{d.offered}</td>
                  <td className="text-xs">{d.matched_at ? `완료 ${fmtDate(d.matched_at)}` : `예정 ${fmtDate(d.match_run_at)}`}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <form action={runMatch}>
                        <input type="hidden" name="date" value={d.run_date} />
                        <PendingButton className="rounded-lg border border-[#E9DCD3] px-2.5 py-1 text-xs" pendingText="계산 중…">미리보기</PendingButton>
                      </form>
                      {!d.matched_at && (
                        <form action={runMatch} className="flex items-center gap-1">
                          <input type="hidden" name="date" value={d.run_date} />
                          <input type="hidden" name="mode" value="apply" />
                          <input type="checkbox" name="confirm" title="실행 확인" className="accent-[#7A1F2B]" />
                          <PendingButton className="rounded-lg bg-[#7A1F2B] px-2.5 py-1 text-xs text-white" pendingText="실행 중…">지금 실행</PendingButton>
                        </form>
                      )}
                      <Link href={`/admin/tables?date=${d.run_date}`} className="text-xs text-[#7A1F2B] underline">테이블</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {/* 학습 상태 */}
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">매칭 가중치 학습 (베이지안)</h2>
            <form action={runLearn}>
              <PendingButton className="rounded-lg border border-[#E9DCD3] px-2.5 py-1 text-xs" pendingText="학습 중…">지금 학습</PendingButton>
            </form>
          </div>
          <p className="mb-3 text-xs text-[#8B6A66]">
            피드백 {learn.n_tables ?? 0}테이블로 갱신한 사후평균(±1 표준편차)과 운영자 설정값(사전평균)을 비교해요. 데이터가 없으면 설정값과 같아요.
          </p>
          {learn.error ? (
            <p className="text-xs text-[#A2412A]">학습 엔진에 연결하지 못했어요: {learn.error}</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(FEATURE_LABEL).map(([k, label]) => {
                const prior = 2 * (weights[k] ?? 0);
                const m = learn.coef?.[k] ?? prior;
                const sd = learn.coef_sd?.[k] ?? 0;
                const scale = (v: number) => `${Math.max(0, Math.min(100, (v / 1.5) * 100))}%`;
                return (
                  <div key={k} className="text-xs">
                    <div className="flex justify-between"><span>{label}</span><span>설정 {prior.toFixed(2)} → 학습 <b>{m.toFixed(2)}</b> ± {sd.toFixed(2)}</span></div>
                    <div className="relative mt-1 h-3 rounded-full bg-[#F4E4DE]">
                      <span className="absolute top-0 h-3 rounded-full bg-[#C9A227]/40" style={{ left: scale(m - sd), width: `calc(${scale(m + sd)} - ${scale(m - sd)})` }} />
                      <span className="absolute top-0 h-3 w-1 rounded-full bg-[#7A1F2B]" style={{ left: scale(m) }} />
                      <span className="absolute -top-0.5 h-4 w-0.5 bg-[#2E1B1E]" style={{ left: scale(prior) }} title="운영자 설정" />
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-[#8B6A66]">
                ▮ 학습값 · 금색 막대 ±1SD · 검은 선 운영자 설정 · 정책: <b>{String(cfg.matching?.policy ?? "mean") === "thompson" ? "Thompson Sampling" : "사후평균"}</b>{" "}
                (<a href={REPORT_URL} target="_blank" rel="noreferrer" className="underline">시뮬레이션 보고서</a>)
              </p>
            </div>
          )}
        </Card>

        {/* 지역 확장 수요 */}
        <Card>
          <h2 className="mb-2 font-semibold">서울 외 지역 확장 수요</h2>
          <p className="mb-3 text-xs text-[#8B6A66]">대기 명단이 {threshold}명 이상 모인 지역은 개설을 검토해요. &ldquo;서울 회차도 괜찮아요&rdquo;를 고른 사람은 서울 매칭에도 들어가요.</p>
          {(demand ?? []).length === 0 ? (
            <p className="text-sm text-[#8B6A66]">아직 대기 명단이 없어요.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {((demand ?? []) as { area: string; people: number; accept_seoul: number }[]).map((r) => (
                <li key={r.area} className="flex items-center gap-2">
                  <span className="w-24 shrink-0">{r.area}</span>
                  <span className="relative h-3 flex-1 rounded-full bg-[#F4E4DE]">
                    <span className="absolute h-3 rounded-full bg-[#7A1F2B]" style={{ width: `${Math.min(100, (r.people / threshold) * 100)}%` }} />
                  </span>
                  <span className="w-28 text-right text-xs">{r.people}/{threshold}명 {r.people >= threshold && <b className="text-[#7A1F2B]">개설 검토</b>}</span>
                </li>
              ))}
            </ul>
          )}
          {sum && (
            <div className="mt-5 border-t border-[#EFE3DC] pt-3 text-xs text-[#6A4A4C]">
              <p className="mb-1 font-semibold text-[#2E1B1E]">피드백 요약</p>
              대화 {sum.avg_convo ?? "-"} · 식당 {sum.avg_venue ?? "-"} · 또 만나고 싶어요 {sum.like_count} · 다시는 {sum.avoid_count} · 노쇼 {sum.no_shows}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, href, warn }: { label: string; value: number | string; sub: string; href?: string; warn?: boolean }) {
  const body = (
    <Card className={`py-4 ${warn ? "ring-1 ring-[#A2412A]" : ""}`}>
      <p className="text-xs text-[#8B6A66]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warn ? "text-[#A2412A]" : "text-[#7A1F2B]"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-[#8B6A66]">{sub}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

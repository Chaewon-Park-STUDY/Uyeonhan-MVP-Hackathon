import Link from "next/link";
import { Card } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { FEATURE_LABEL, callEngine, requireAdmin } from "@/lib/admin";
import { fmtDate } from "@/lib/labels";
import { runLearn, runMatch } from "./actions";
import { RegionMap } from "./region-map";
import { Schedule } from "./schedule";

type Row = { run_date: string; slots: number; open_slots: number; apps_total: number; apps_paid: number; apps_pending: number;
  confirmed_tables: number; confirmed_people: number; offered: number; matched_at: string | null; match_run_at: string; deadline: string };
type Learn = { n_tables?: number; coef?: Record<string, number>; coef_sd?: Record<string, number>; status?: string; error?: string };
type Summary = { n_tables: number; n_feedback: number; avg_table: number | null; avg_convo: number | null; avg_venue: number | null;
  like_count: number; avoid_count: number; reports: number; no_shows: number };

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
  const { data: regionStats } = next
    ? await supabase.rpc("admin_region_stats", { p_date: next.run_date })
    : { data: [] };
  const result = sp.result ? (JSON.parse(sp.result) as { date: string; dry: boolean; out: Record<string, unknown> }) : null;

  return (
    <div className="space-y-5">
      {sp.msg && <p className="rounded-xl bg-[#FCEDE8] px-4 py-3 text-sm text-[#A2412A]">{sp.msg}</p>}
      {sp.learn && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">학습 결과: {sp.learn}</p>}
      {result && (
        <Card className="text-sm">
          <p className="font-semibold">{result.date} 매칭 {result.dry ? "미리보기 (저장하지 않았어요)" : "실행 완료"}</p>
          <MatchSummary out={result.out} />
        </Card>
      )}

      <Schedule rows={dates.map((d) => ({ run_date: d.run_date, deadline: d.deadline, matched_at: d.matched_at }))} />

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
        {/* 학습 상태 — 운영자용 쉬운 말 (계산 방식은 DESIGN.md) */}
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">피드백으로 배우는 매칭 기준</h2>
            <form action={runLearn}>
              <PendingButton className="rounded-lg border border-[#E9DCD3] px-2.5 py-1 text-xs" pendingText="반영 중…">피드백 지금 반영</PendingButton>
            </form>
          </div>
          <p className="mb-3 text-sm leading-relaxed text-[#6A4A4C]">
            참가자 만족에 <b>어떤 기준이 얼마나 중요한지</b> 순위로 보여줘요. 처음엔 설정 화면의 비중대로 시작하고,
            피드백이 쌓이면 실제로 만족도를 높인 기준의 비중이 커져요.
          </p>
          <p className="mb-3 rounded-lg bg-[#FBF1EC] px-3 py-2 text-sm">
            {(learn.n_tables ?? 0) === 0
              ? "아직 반영된 피드백이 없어서 처음 설정 그대로예요. 모임이 끝나고 피드백이 쌓이면 자동으로 바뀌어요."
              : `피드백 ${learn.n_tables}개 테이블을 반영했어요.`}
          </p>
          {learn.error ? (
            <p className="text-sm text-[#A2412A]">지금은 계산 결과를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>
          ) : (() => {
            const keys = Object.keys(FEATURE_LABEL);
            const now = keys.map((k) => Math.max(0, learn.coef?.[k] ?? 2 * (weights[k] ?? 0)));
            const tot = now.reduce((a, b) => a + b, 0) || 1;
            const rows = keys.map((k, i) => ({ k, label: FEATURE_LABEL[k], now: now[i] / tot, first: weights[k] ?? 0, sd: learn.coef_sd?.[k] ?? 1 }))
              .sort((a, b) => b.now - a.now);
            return (
              <div className="space-y-3">
                {rows.map((r, i) => {
                  const diff = Math.round((r.now - r.first) * 100);
                  return (
                    <div key={r.k} className="text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span><b className="mr-1.5 text-[#C9A227]">{i + 1}위</b><span className="font-medium">{r.label}</span></span>
                        <span>
                          <b className="text-[#7A1F2B]">{Math.round(r.now * 100)}%</b>
                          {diff !== 0 && <span className={`ml-1.5 text-xs ${diff > 0 ? "text-[#2F6B3A]" : "text-[#A2412A]"}`}>{diff > 0 ? `▲ ${diff}%p` : `▼ ${-diff}%p`}</span>}
                          <span className="ml-1.5 text-xs text-[#8B6A66]">(처음 {Math.round(r.first * 100)}%)</span>
                        </span>
                      </div>
                      <div className="relative mt-1 h-3 rounded-full bg-[#F4E4DE]">
                        <span className="absolute left-0 top-0 h-3 rounded-full bg-[#7A1F2B]" style={{ width: `${Math.min(100, r.now * 200)}%` }} />
                        <span className="absolute -top-0.5 h-4 w-0.5 bg-[#C9A227]" style={{ left: `${Math.min(100, r.first * 200)}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-[#8B6A66]">빨간 막대 = 지금 비중 · 금색 선 = 처음 설정 · 비중은 설정 화면에서 바꿀 수 있어요</p>
              </div>
            );
          })()}
        </Card>

        {/* 지역 지도 */}
        <Card>
          <h2 className="mb-1 font-semibold">지역별 현황 지도</h2>
          <p className="mb-2 text-xs text-[#8B6A66]">서울 밖은 대기 명단이 {threshold}명 모이면 개설을 검토해요.</p>
          <RegionMap
            regions={((regionStats ?? []) as { region_code: string; label: string; apps: number; tables: number }[])
              .map((r) => ({ code: r.region_code, label: r.label, apps: Number(r.apps), tables: Number(r.tables) }))}
            demand={((demand ?? []) as { area: string; people: number }[]).map((d) => ({ area: d.area, people: Number(d.people) }))}
            threshold={threshold} dateLabel={next?.run_date ?? "-"} />
          {sum && (
            <div className="mt-4 border-t border-[#EFE3DC] pt-3 text-xs text-[#6A4A4C]">
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

function MatchSummary({ out }: { out: Record<string, unknown> }) {
  if (out.error) return <p className="mt-2 text-[#A2412A]">실행하지 못했어요: {String(out.error)}</p>;
  if (out.status === "NOTHING_DUE") return <p className="mt-2 text-[#6A4A4C]">지금 실행할 회차가 없어요.</p>;
  if ((out.db as { status?: string } | undefined)?.status === "ALREADY_RUN") return <p className="mt-2 text-[#6A4A4C]">이미 매칭이 끝난 날짜예요.</p>;
  const st = (out.stats ?? {}) as Record<string, number | null>;
  const items: [string, number | string | null | undefined][] = [
    ["매칭 대상 (결제 완료)", st.applications], ["만들어진 테이블", st.tables_confirmed], ["자리 배정", st.placed],
    ["다음 희망 날짜로 넘김", st.carried_over], ["다른 회차 제안", st.failed],
    ["예상 평균 만족도 (5점)", st.mean_pred],
  ];
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-[#FBF1EC] px-3 py-2">
          <p className="text-[11px] text-[#8B6A66]">{k}</p>
          <p className="text-lg font-bold text-[#7A1F2B]">{v ?? "-"}</p>
        </div>
      ))}
    </div>
  );
}

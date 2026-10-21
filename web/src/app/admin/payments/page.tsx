import { AdminTitle, FilterChips, Pill, Stat, TableWrap, shortDt, td, th } from "@/components/admin-ui";
import { requireAdmin } from "@/lib/admin";
import { PASSES, PAYMENT_LABEL, won } from "@/lib/labels";

type Pay = { id: string; amount: number; discount_amount: number; method: string; status: string; refund_amount: number | null;
  created_at: string; refunded_at: string | null;
  applications: { id: string; match_status: string; profiles: { name: string } | null; passes: { type: string } | null } | null };
type Pass = { id: string; type: string; remaining: number | null; expires_at: string | null; extended_days: number; created_at: string; profiles: { name: string } | null };

// PRD §11 결제·환불: 결제·자동 환불·환불 실패·이용권 사용 내역 조회
export default async function Payments({ searchParams }: { searchParams: Promise<{ status?: string; view?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: pays }, { data: passes }] = await Promise.all([
    supabase.from("payments").select("id, amount, discount_amount, method, status, refund_amount, created_at, refunded_at, applications(id, match_status, profiles(name), passes(type))")
      .order("created_at", { ascending: false }).limit(1000),
    supabase.from("passes").select("id, type, remaining, expires_at, extended_days, created_at, profiles(name)").order("created_at", { ascending: false }).limit(300),
  ]);
  const all = (pays ?? []) as unknown as Pay[];
  const list = sp.status ? all.filter((p) => p.status === sp.status) : all;
  const sum = (f: (p: Pay) => number) => all.reduce((a, p) => a + f(p), 0);
  const paidTotal = sum((p) => (["PAID", "REFUNDED", "REFUND_PROCESSING", "REFUND_REQUESTED"].includes(p.status) ? p.amount : 0));
  const refundTotal = sum((p) => (p.status === "REFUNDED" ? p.refund_amount ?? 0 : 0));
  const count = (s: string) => all.filter((p) => p.status === s).length;
  const tone = (s: string) => (s === "PAID" ? "ok" : s === "PENDING" ? "wait" : s === "REFUNDED" ? "info" : s.startsWith("REFUND") ? "info" : "warn");
  const passName = (t?: string) => PASSES.find((x) => x.value === t)?.label ?? t ?? "-";

  return (
    <div className="space-y-4">
      <AdminTitle title="결제·환불" desc="시연 버전은 모의 결제예요. 매칭 실패 후 환불을 고르면 운영자 승인 없이 원래 결제 수단으로 자동 환불돼요. 실패한 건만 처리대기함으로 가요.">
        <div className="ml-auto"><FilterChips base="/admin/payments" param="view" current={sp.view ?? ""} keep={{ status: sp.status }}
          options={[["", "결제 내역"], ["passes", "이용권 내역"]]} /></div>
      </AdminTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="결제 금액 합계" value={won(paidTotal)} />
        <Stat label="결제 완료" value={count("PAID")} tone="ok" />
        <Stat label="결제 대기" value={count("PENDING")} />
        <Stat label="자동 환불 완료" value={`${count("REFUNDED")}건 · ${won(refundTotal)}`} />
        <Stat label="환불 실패" value={count("REFUND_FAILED")} tone={count("REFUND_FAILED") ? "warn" : undefined} />
      </div>

      {sp.view !== "passes" ? (
        <>
          <FilterChips base="/admin/payments" param="status" current={sp.status}
                       options={[["", "전체"], ["PENDING", "결제 대기"], ["PAID", "결제 완료"], ["REFUND_PROCESSING", "환불 처리 중"], ["REFUNDED", "환불 완료"], ["REFUND_FAILED", "환불 실패"], ["FAILED", "결제 실패"]]} />
          <TableWrap min={820}>
            <thead><tr><th className={th}>결제 시각</th><th className={th}>이름</th><th className={th}>이용권</th><th className={th}>금액</th>
              <th className={th}>할인</th><th className={th}>수단</th><th className={th}>상태</th><th className={th}>환불</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td className={td} colSpan={8}>내역이 없어요.</td></tr>}
              {list.slice(0, 300).map((p) => (
                <tr key={p.id}>
                  <td className={`${td} text-xs`}>{shortDt(p.created_at)}</td>
                  <td className={td}>{p.applications?.profiles?.name ?? "-"}</td>
                  <td className={`${td} text-xs`}>{passName(p.applications?.passes?.type)}</td>
                  <td className={td}>{won(p.amount)}</td>
                  <td className={`${td} text-xs`}>{p.discount_amount ? `-${won(p.discount_amount)}` : "-"}</td>
                  <td className={`${td} text-xs`}>{p.method === "MEMBERSHIP" ? "멤버십 사용" : "모의 결제"}</td>
                  <td className={td}><Pill tone={tone(p.status)}>{PAYMENT_LABEL[p.status] ?? p.status}</Pill></td>
                  <td className={`${td} text-xs`}>{p.refund_amount != null ? `${won(p.refund_amount)} · ${shortDt(p.refunded_at)}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      ) : (
        <TableWrap min={700}>
          <thead><tr><th className={th}>발급</th><th className={th}>이름</th><th className={th}>이용권</th><th className={th}>남은 횟수 / 기간</th><th className={th}>매칭 실패로 연장</th></tr></thead>
          <tbody>
            {((passes ?? []) as unknown as Pass[]).map((x) => (
              <tr key={x.id}>
                <td className={`${td} text-xs`}>{shortDt(x.created_at)}</td>
                <td className={td}>{x.profiles?.name ?? "-"}</td>
                <td className={td}>{passName(x.type)}</td>
                <td className={`${td} text-xs`}>{x.type === "SINGLE" ? `${x.remaining ?? 0}회 남음` : `${shortDt(x.expires_at)}까지`}</td>
                <td className={`${td} text-xs`}>{x.extended_days ? `+${x.extended_days}일` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { Card, ErrorBox, Page, Submit } from "@/components/ui";
import { PASSES, REFUND_POLICY, REGION_LABEL, fmtDate, won } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { pay } from "./actions";

export default async function PayPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, user } = await getMe();
  if (!user) redirect(`/login?next=/pay/${id}`);

  const { data: app } = await supabase
    .from("applications")
    .select("id, application_status, payment_status, passes(type), payments(amount, discount_amount), application_slots(event_slots(starts_at, region_code))")
    .eq("id", id).maybeSingle();
  if (!app) notFound();
  if (app.payment_status === "PAID") redirect(`/?done=${id}`);
  if (app.application_status !== "SUBMITTED" || app.payment_status !== "PENDING") redirect("/");   // 취소했거나 결제할 게 없음

  const pass = PASSES.find((p) => p.value === (app.passes as unknown as { type: string } | null)?.type);
  const payment = (app.payments as unknown as { amount: number; discount_amount: number }[])[0];
  const slots = (app.application_slots as unknown as { event_slots: { starts_at: string; region_code: string } }[])
    .map((s) => s.event_slots)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <Page title="결제하기" back="/">
      <ErrorBox message={error} />
      <Card className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-[#8B6A66]">이용권</span>
          <span className="font-semibold">{pass?.label}</span>
        </div>
        <div className="text-sm">
          <p className="mb-1 text-[#8B6A66]">신청한 회차 (이 중 한 곳으로 매칭돼요)</p>
          <ul className="space-y-1">
            {slots.map((s, i) => (
              <li key={i}>· {fmtDate(s.starts_at)} {REGION_LABEL[s.region_code]}</li>
            ))}
          </ul>
        </div>
        {payment?.discount_amount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-[#8B6A66]">쿠폰 할인</span>
            <span>-{won(payment.discount_amount)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-[#EFE3DC] pt-3 text-lg font-bold">
          <span>결제 금액</span>
          <span>{won(payment?.amount ?? 0)}</span>
        </div>
      </Card>

      <Card className="mt-4 bg-[#FBF1EC]">
        <p className="mb-2 text-sm font-semibold">결제 전에 확인해 주세요</p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-[#6A4A4C]">
          {REFUND_POLICY.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </Card>

      <form action={pay} className="mt-5">
        <input type="hidden" name="id" value={id} />
        <Submit>{won(payment?.amount ?? 0)} 결제하기</Submit>
      </form>
    </Page>
  );
}

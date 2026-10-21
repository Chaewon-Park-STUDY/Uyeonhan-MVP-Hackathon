import { redirect } from "next/navigation";
import { ButtonLink, Card, Page } from "@/components/ui";
import { REGION_LABEL, fmtDate, fmtDeadline } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";

type Slot = { id: string; starts_at: string; region_code: string; apply_deadline: string };

export default async function FeedbackDone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await getMe();
  if (!user) redirect("/login");

  const nowIso = new Date().toISOString();
  const [{ data: coupons }, { data: slots }] = await Promise.all([
    supabase.from("coupons").select("discount_rate, expires_at").eq("kind", "REVISIT").is("used_at", null)
      .gt("expires_at", nowIso).order("created_at", { ascending: false }).limit(1),
    supabase.from("event_slots").select("id, starts_at, region_code, apply_deadline")
      .eq("is_open", true).gt("apply_deadline", nowIso).order("starts_at").limit(8),
  ]);
  const coupon = coupons?.[0];
  // 다음 회차 추천: 가장 가까운 날짜 중 지난번과 같은 지역 우선
  const { data: info } = await supabase.rpc("table_info", { p_table_id: id }).maybeSingle<{ region_code: string }>();
  const list = ((slots ?? []) as Slot[]).sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at) || Number(b.region_code === info?.region_code) - Number(a.region_code === info?.region_code));
  const next = list[0];

  return (
    <Page title="고마워요!">
      <p className="-mt-3 mb-5 text-sm text-[#6A4A4C]">{profile?.name}님의 피드백은 다음 매칭을 더 정교하게 만드는 데 쓰여요.</p>
      {coupon && (
        <Card className="mb-4 border-2 border-dashed border-[#7A1F2B] text-center">
          <p className="text-xs text-[#8B6A66]">재방문 쿠폰</p>
          <p className="mt-1 text-3xl font-bold text-[#7A1F2B]">{Math.round(coupon.discount_rate * 100)}% 할인</p>
          <p className="mt-1 text-xs text-[#8B6A66]">{fmtDate(coupon.expires_at).split(" ").slice(0, 3).join(" ")}까지 · 다음 신청 때 자동으로 보여요</p>
        </Card>
      )}
      {next && (
        <Card className="mb-4">
          <p className="text-xs text-[#8B6A66]">다음 우연한 식탁</p>
          <p className="mt-1 font-bold">{fmtDate(next.starts_at)} · {REGION_LABEL[next.region_code]}</p>
          <p className="mt-0.5 text-xs text-[#8B6A66]">신청 마감 {fmtDeadline(next.apply_deadline)}</p>
          <div className="mt-3"><ButtonLink href="/apply">{coupon ? "쿠폰 쓰고 신청하기" : "신청하기"}</ButtonLink></div>
        </Card>
      )}
      <ButtonLink href="/" tone="ghost">홈으로</ButtonLink>
    </Page>
  );
}

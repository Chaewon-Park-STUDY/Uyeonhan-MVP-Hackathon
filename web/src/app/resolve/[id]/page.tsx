import { tidyReason } from "@/lib/labels";
import { notFound, redirect } from "next/navigation";
import { Card, ErrorBox, Page, Submit } from "@/components/ui";
import { REGION_LABEL, fmtDate } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { resolve } from "./actions";

type Slot = { id: string; starts_at: string; region_code: string };

export default async function ResolvePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, user } = await getMe();
  if (!user) redirect(`/login?next=/resolve/${id}`);

  const { data: app } = await supabase
    .from("applications")
    .select("id, match_status, fail_pref, passes(type), match_resolutions(offered_slots, reason)")
    .eq("id", id).maybeSingle();
  if (!app) notFound();
  if (app.match_status !== "ALTERNATIVE_OFFERED") redirect("/");

  const res = app.match_resolutions as unknown as { offered_slots: string[]; reason: string | null } | null;
  const offered = res?.offered_slots ?? [];
  const { data: slots } = offered.length
    ? await supabase.from("event_slots").select("id, starts_at, region_code").in("id", offered)
        .eq("is_open", true).gt("apply_deadline", new Date().toISOString()).order("starts_at")
    : { data: [] as Slot[] };
  // 같은 날 이미 진행 중인 다른 신청이 있으면 그 날짜는 고를 수 없게
  const { data: others } = await supabase.from("applications")
    .select("id, match_status, payment_status, application_slots(event_slots(starts_at))")
    .eq("application_status", "SUBMITTED").neq("id", id).neq("match_status", "NO_MATCH");
  const day = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const busy = new Set(((others ?? []) as unknown as { payment_status: string; application_slots: { event_slots: { starts_at: string } | null }[] }[])
    .filter((o) => !o.payment_status.startsWith("REFUND"))
    .flatMap((o) => o.application_slots.map((x) => x.event_slots && day(x.event_slots.starts_at)).filter(Boolean) as string[]));
  const firstFree = ((slots ?? []) as Slot[]).findIndex((s) => !busy.has(day(s.starts_at)));
  const membership = (app.passes as unknown as { type: string } | null)?.type !== "SINGLE";

  return (
    <Page title="다른 일정을 골라 주세요" back="/">
      <p className="-mt-3 mb-5 text-sm text-[#6A4A4C]">
        이번 회차에는 조건에 맞는 테이블을 만들지 못했어요{res?.reason ? ` (사유: ${tidyReason(res.reason)})` : ""}. 나이 차이·차단 같은 필수 조건은 낮추지 않기 때문이에요.
        결제는 그대로 유지돼요.
      </p>
      <ErrorBox message={error} />
      <form action={resolve} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Card>
          <p className="mb-3 font-semibold">자리가 있는 회차로 옮기기</p>
          {(slots ?? []).length === 0 && <p className="text-sm text-[#8B6A66]">지금 옮길 수 있는 회차가 없어요.</p>}
          <div className="space-y-2">
            {((slots ?? []) as Slot[]).map((s, i) => {
              const taken = busy.has(day(s.starts_at));
              return (
                <label key={s.id} className={`flex items-center gap-2 rounded-xl border border-[#E9DCD3] px-4 py-3 text-sm has-[:checked]:border-[#7A1F2B] has-[:checked]:bg-[#FBF1EC] ${taken ? "opacity-50" : ""}`}>
                  <input type="radio" name="choice" value={`MOVE_DATE:${s.id}`} defaultChecked={i === firstFree} disabled={taken} className="accent-[#7A1F2B]" />
                  {fmtDate(s.starts_at)} · {REGION_LABEL[s.region_code]}
                  {taken && <span className="ml-auto text-xs">이 날은 이미 다른 신청이 있어요</span>}
                </label>
              );
            })}
          </div>
        </Card>
        <Card className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="choice" value="KEEP_PASS" defaultChecked={firstFree < 0} className="accent-[#7A1F2B]" />
            {membership ? "다음에 쓸게요 (멤버십 기간 7일 연장)" : "이용권을 보관하고 다음에 쓸게요"}
          </label>
          {!membership && (
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="choice" value="REFUND" className="accent-[#7A1F2B]" />
              전액 환불받을게요 (결제한 수단으로 바로 환불)
            </label>
          )}
        </Card>
        <Submit>이대로 할게요</Submit>
      </form>
    </Page>
  );
}

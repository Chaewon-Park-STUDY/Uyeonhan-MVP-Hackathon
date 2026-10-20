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
    .select("id, match_status, fail_pref, passes(type), match_resolutions(offered_slots)")
    .eq("id", id).maybeSingle();
  if (!app) notFound();
  if (app.match_status !== "ALTERNATIVE_OFFERED") redirect("/");

  const offered = ((app.match_resolutions as unknown as { offered_slots: string[] } | null)?.offered_slots) ?? [];
  const { data: slots } = offered.length
    ? await supabase.from("event_slots").select("id, starts_at, region_code").in("id", offered).order("starts_at")
    : { data: [] as Slot[] };
  const membership = (app.passes as unknown as { type: string } | null)?.type !== "SINGLE";

  return (
    <Page title="다른 일정을 골라 주세요" back="/">
      <p className="-mt-3 mb-5 text-sm text-[#6A4A4C]">
        이번 회차에는 조건에 맞는 테이블을 만들지 못했어요. 나이 차이·차단 같은 필수 조건은 낮추지 않기 때문이에요.
        결제는 그대로 유지돼요.
      </p>
      <ErrorBox message={error} />
      <form action={resolve} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Card>
          <p className="mb-3 font-semibold">자리가 있는 회차로 옮기기</p>
          {(slots ?? []).length === 0 && <p className="text-sm text-[#8B6A66]">지금 옮길 수 있는 회차가 없어요.</p>}
          <div className="space-y-2">
            {((slots ?? []) as Slot[]).map((s, i) => (
              <label key={s.id} className="flex items-center gap-2 rounded-xl border border-[#E9DCD3] px-4 py-3 text-sm has-[:checked]:border-[#7A1F2B] has-[:checked]:bg-[#FBF1EC]">
                <input type="radio" name="choice" value={`MOVE_DATE:${s.id}`} defaultChecked={i === 0} className="accent-[#7A1F2B]" />
                {fmtDate(s.starts_at)} · {REGION_LABEL[s.region_code]}
              </label>
            ))}
          </div>
        </Card>
        <Card className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="choice" value="KEEP_PASS" defaultChecked={(slots ?? []).length === 0} className="accent-[#7A1F2B]" />
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

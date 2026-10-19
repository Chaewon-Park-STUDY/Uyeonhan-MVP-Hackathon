import { redirect } from "next/navigation";
import { Card, ErrorBox, Label, Page, Submit } from "@/components/ui";
import { FAIL_PREFS, PASSES, REFUND_POLICY, REGION_LABEL, fmtDate, fmtDeadline, won } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { submitApplication } from "./actions";

type Slot = { id: string; starts_at: string; region_code: string; apply_deadline: string };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase, user, profile } = await getMe();
  if (!user) redirect("/login?next=/apply");
  if (!profile) redirect("/onboarding");

  const nowIso = new Date().toISOString();
  const [{ data: slots }, { data: passes }, { data: coupons }, { data: credit }] = await Promise.all([
    supabase.from("event_slots").select("id, starts_at, region_code, apply_deadline")
      .eq("is_open", true).gt("apply_deadline", nowIso).order("starts_at").order("region_code"),
    supabase.from("passes").select("type, expires_at").neq("type", "SINGLE").gt("expires_at", nowIso)
      .order("expires_at", { ascending: false }).limit(1),
    supabase.from("coupons").select("id, kind, discount_rate, expires_at").is("used_at", null).gt("expires_at", nowIso),
    supabase.rpc("my_credit"),
  ]);

  const byDate = new Map<string, Slot[]>();
  for (const s of (slots ?? []) as Slot[]) {
    const key = s.starts_at.slice(0, 10);
    byDate.set(key, [...(byDate.get(key) ?? []), s]);
  }
  const membership = passes?.[0];

  return (
    <Page title="참가 신청" back="/">
      <ErrorBox message={error} />
      <form action={submitApplication} className="space-y-4">
        <Card>
          <Label hint="갈 수 있는 날짜·지역을 모두 고르면 매칭될 가능성이 높아져요">참가 가능한 회차</Label>
          {byDate.size === 0 && <p className="text-sm text-[#9A7B66]">지금 모집 중인 회차가 없어요.</p>}
          <div className="space-y-4">
            {[...byDate.entries()].map(([date, list]) => (
              <div key={date}>
                <p className="mb-1 text-sm font-semibold">{fmtDate(list[0].starts_at)}</p>
                <p className="mb-2 text-xs text-[#9A7B66]">신청 마감·매칭 {fmtDeadline(list[0].apply_deadline)}</p>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <label key={s.id} className="cursor-pointer">
                      <input type="checkbox" name="slot" value={s.id} className="peer sr-only" />
                      <span className="inline-block rounded-full border border-[#E8DCCD] bg-[#FFFDF9] px-3 py-1.5 text-sm peer-checked:border-[#B9784A] peer-checked:bg-[#B9784A] peer-checked:text-white">
                        {REGION_LABEL[s.region_code] ?? s.region_code}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <Label>이용권</Label>
          {!membership && credit === "KEPT_PASS" ? (
            <p className="rounded-xl bg-[#F3E6D6] px-4 py-3 text-sm">
              지난번에 <b>보관한 1회권</b>이 있어요. 추가 결제 없이 신청돼요.
              <input type="hidden" name="pass" value="SINGLE" />
            </p>
          ) : membership ? (
            <p className="rounded-xl bg-[#F3E6D6] px-4 py-3 text-sm">
              멤버십 이용 중이에요 ({fmtDate(membership.expires_at).split(" ").slice(0, 2).join(" ")}까지). 추가 결제 없이 신청돼요.
              <input type="hidden" name="pass" value={membership.type} />
            </p>
          ) : (
            <div className="space-y-2">
              {PASSES.map((p, i) => (
                <label key={p.value} className="flex items-center justify-between rounded-xl border border-[#E8DCCD] px-4 py-3 text-sm has-[:checked]:border-[#B9784A] has-[:checked]:bg-[#FFF8F0]">
                  <span className="flex items-center gap-2">
                    <input type="radio" name="pass" value={p.value} defaultChecked={i === 0} className="accent-[#B9784A]" />
                    <span>
                      <b>{p.label}</b> <span className="text-[#9A7B66]">· {p.note}</span>
                    </span>
                  </span>
                  <span className="font-semibold">{won(p.price)}</span>
                </label>
              ))}
            </div>
          )}
          {!membership && credit !== "KEPT_PASS" && (coupons?.length ?? 0) > 0 && (
            <>
              <Label>쿠폰</Label>
              <select name="coupon" className="w-full rounded-xl border border-[#E8DCCD] bg-[#FFFDF9] px-4 py-3">
                <option value="">사용 안 함</option>
                {coupons!.map((c) => (
                  <option key={c.id} value={c.id}>
                    {Math.round(c.discount_rate * 100)}% 할인 쿠폰
                  </option>
                ))}
              </select>
            </>
          )}
        </Card>

        <Card>
          <Label hint="매칭 결과를 기다리지 않고 미리 정해 두면 바로 처리돼요">매칭이 안 되면</Label>
          <div className="space-y-2">
            {FAIL_PREFS.map((f) => (
              <label key={f.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="fail_pref" value={f.value}
                       defaultChecked={(profile.default_fail_pref ?? "MOVE_DATE") === f.value} className="accent-[#B9784A]" />
                {f.label}
              </label>
            ))}
          </div>
        </Card>

        <Card className="bg-[#FFF8F0]">
          <p className="mb-2 text-sm font-semibold">환불 규정</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-[#7A5E4B]">
            {REFUND_POLICY.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </Card>

        <Submit>신청하기</Submit>
      </form>
    </Page>
  );
}

import { redirect } from "next/navigation";
import { Card, ErrorBox, Label, Page, Submit } from "@/components/ui";
import { FAIL_PREFS, PASSES, REFUND_POLICY, REGION_LABEL, fmtDate, fmtDeadline, won } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { type BoardSlot, type SlotStat, SlotPicker } from "@/components/schedule-board";
import { submitApplication } from "./actions";

const COUPON_NAME: Record<string, string> = { REVISIT: "재방문", REFERRAL_NEW: "친구 초대(환영)", REFERRAL_INVITER: "친구 초대(감사)", LAST_MINUTE: "마감 할인", NO_SHOW_COMPENSATION: "보상" };

type Slot = { id: string; starts_at: string; region_code: string; apply_deadline: string };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ error?: string; welcome?: string; ref_ok?: string; ref_error?: string }> }) {
  const { error, welcome, ref_ok, ref_error } = await searchParams;
  const { supabase, user, profile } = await getMe();
  if (!user) redirect("/login?next=/apply");
  if (!profile) redirect("/onboarding");

  const nowIso = new Date().toISOString();
  const [{ data: slots }, { data: passes }, { data: coupons }, { data: credit }, { data: stats }, { data: reviews }] = await Promise.all([
    supabase.from("event_slots").select("id, starts_at, region_code, apply_deadline")
      .eq("is_open", true).gt("apply_deadline", nowIso).order("starts_at").order("region_code"),
    supabase.from("passes").select("type, expires_at").neq("type", "SINGLE").gt("expires_at", nowIso)
      .order("expires_at", { ascending: false }).limit(1),
    supabase.from("coupons").select("id, kind, discount_rate, expires_at").is("used_at", null).gt("expires_at", nowIso),
    supabase.rpc("my_credit"),
    supabase.rpc("slot_stats"),
    supabase.rpc("region_reviews"),
  ]);
  // 회차 인기도 (신청 수·정원만 집계, 개인정보 없음)
  type Review = { region_code: string; avg_score: number; n: number; comments: { text: string; date: string; score: number }[] };
  // 평가가 3명 이상 모인 지역만 (한두 명 점수로 지역 전체를 판단하지 않게)
  const reviewList = ((reviews ?? []) as Review[]).filter((x) => Number(x.n) >= 3);

  const byDate = new Map<string, Slot[]>();
  for (const s of (slots ?? []) as Slot[]) {
    const key = s.starts_at.slice(0, 10);
    byDate.set(key, [...(byDate.get(key) ?? []), s]);
  }
  const membership = passes?.[0];

  return (
    <Page title="참가 신청" back="/">
      {welcome && (
        <p className="mb-4 rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">
          자리 카드를 저장했어요. 이제 갈 수 있는 날짜를 골라 주세요. <a href="/profile" className="underline">내 프로필 보기</a>
        </p>
      )}
      {ref_ok && <p className="mb-4 rounded-xl bg-[#FBEFD0] px-4 py-3 text-sm text-[#8A5B00]">🎁 초대 코드가 확인됐어요. 아래 쿠폰에서 친구 초대 할인을 고를 수 있어요.</p>}
      {ref_error && <p className="mb-4 rounded-xl bg-[#FCEDE8] px-4 py-3 text-sm text-[#A2412A]">초대 코드: {ref_error}</p>}
      <ErrorBox message={error} />
      <form action={submitApplication} className="space-y-4">
        <Card>
          <Label>참가 가능한 회차</Label>
          <SlotPicker slots={(slots ?? []) as BoardSlot[]} stats={(stats ?? []) as SlotStat[]} />
        </Card>

        {reviewList.length > 0 && (
          <Card>
            <Label hint="실제로 식사한 분들이 남긴 평가예요 (이름 없이) · 지역을 누르면 한마디가 보여요">지난 모임 후기</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {reviewList.map((rv) => (
                <details key={rv.region_code} className="group rounded-xl bg-[#FBF7F0] px-3 py-2.5 text-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                    <b>{REGION_LABEL[rv.region_code]}</b>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[#C9A227]">★ {rv.avg_score}</span>
                      <span className="text-xs text-[#8B6A66]">{rv.n}명 평가</span>
                      <span className="text-xs text-[#B7A3A0] transition group-open:rotate-180">▾</span>
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1.5 border-t border-[#EFE3DC] pt-2">
                    {rv.comments.length === 0 && <p className="text-xs text-[#8B6A66]">아직 남겨진 한마디가 없어요.</p>}
                    {rv.comments.map((c, i) => (
                      <p key={i} className="text-xs leading-relaxed text-[#4A3436]">
                        <span className="text-[#C9A227]">{"★".repeat(c.score)}</span> “{c.text}”
                        <span className="ml-1 text-[#B7A3A0]">· {c.date} 참가자</span>
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <Label>이용권</Label>
          {!membership && credit === "KEPT_PASS" ? (
            <p className="rounded-xl bg-[#F4E4DE] px-4 py-3 text-sm">
              지난번에 <b>보관한 1회권</b>이 있어요. 추가 결제 없이 신청돼요.
              <input type="hidden" name="pass" value="SINGLE" />
            </p>
          ) : membership ? (
            <p className="rounded-xl bg-[#F4E4DE] px-4 py-3 text-sm">
              멤버십 이용 중이에요 ({fmtDate(membership.expires_at).split(" ").slice(0, 2).join(" ")}까지). 추가 결제 없이 신청돼요.
              <input type="hidden" name="pass" value={membership.type} />
            </p>
          ) : (
            <div className="space-y-2">
              {PASSES.map((p, i) => (
                <label key={p.value} className="flex items-center justify-between rounded-xl border border-[#E9DCD3] px-4 py-3 text-sm has-[:checked]:border-[#7A1F2B] has-[:checked]:bg-[#FBF1EC]">
                  <span className="flex items-center gap-2">
                    <input type="radio" name="pass" value={p.value} defaultChecked={i === 0} className="accent-[#7A1F2B]" />
                    <span>
                      <b>{p.label}</b> <span className="text-[#8B6A66]">· {p.note}</span>
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
              <select name="coupon" className="w-full rounded-xl border border-[#E9DCD3] bg-[#FFFCF9] px-4 py-3">
                <option value="">사용 안 함</option>
                {coupons!.map((c) => (
                  <option key={c.id} value={c.id}>
                    {COUPON_NAME[c.kind] ?? "할인"} 쿠폰 · {Math.round(c.discount_rate * 100)}% 할인
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
                       defaultChecked={(profile.default_fail_pref ?? "MOVE_DATE") === f.value} className="accent-[#7A1F2B]" />
                {f.label}
              </label>
            ))}
          </div>
        </Card>

        <Card className="bg-[#FBF1EC]">
          <p className="mb-2 text-sm font-semibold">환불 규정</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-[#6A4A4C]">
            {REFUND_POLICY.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </Card>

        <Submit>신청하기</Submit>
      </form>
    </Page>
  );
}

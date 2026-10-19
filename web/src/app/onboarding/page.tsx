import { redirect } from "next/navigation";
import { Card, Chips, ErrorBox, Label, Page, Submit, inputCls } from "@/components/ui";
import { ALLERGIES, BUDGETS, DESIRED, DISLIKES, FAIL_PREFS, INTERESTS, SELF_TRAITS } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { saveProfile } from "./actions";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { user, profile } = await getMe();
  if (!user) redirect("/login?next=/onboarding");
  const p = profile ?? {};
  const thisYear = new Date().getFullYear();

  return (
    <Page title={profile ? "내 프로필" : "나를 소개해 주세요"}>
      <p className="-mt-3 mb-5 text-sm text-[#7A5E4B]">
        잘 맞는 테이블을 만드는 데만 쓰여요. 다른 참가자에게는 연락처·출생연도가 공개되지 않아요.
      </p>
      <ErrorBox message={error} />
      <form action={saveProfile} className="space-y-4">
        <Card>
          <Label>기본 정보</Label>
          <div className="space-y-3">
            <input name="name" required defaultValue={p.name} placeholder="이름" className={inputCls} />
            <input name="phone" defaultValue={p.phone ?? ""} placeholder="연락처 (선택)" className={inputCls} />
            <div className="grid grid-cols-2 gap-3">
              <input name="birth_year" type="number" required min={thisYear - 60} max={thisYear - 19}
                     defaultValue={p.birth_year} placeholder="출생연도 (예: 1997)" className={inputCls} />
              <select name="gender" required defaultValue={p.gender ?? ""} className={inputCls}>
                <option value="" disabled>성별</option>
                <option value="F">여성</option>
                <option value="M">남성</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input name="job" defaultValue={p.job ?? ""} placeholder="직업 (예: 마케터)" className={inputCls} />
              <input name="mbti" defaultValue={p.mbti ?? ""} maxLength={4} placeholder="MBTI (선택)" className={`${inputCls} uppercase`} />
            </div>
          </div>
        </Card>

        <Card>
          <Label hint="여러 개 골라도 돼요">요즘 관심사</Label>
          <Chips name="interests" options={INTERESTS} checked={p.interests ?? []} />
          <Label>나는 어떤 사람인가요?</Label>
          <Chips name="self_traits" options={SELF_TRAITS} checked={p.self_traits ?? []} />
          <Label>어떤 사람을 만나고 싶나요?</Label>
          <Chips name="desired_traits" options={DESIRED} checked={p.desired_traits ?? []} />
        </Card>

        <Card>
          <Label hint="식당을 정할 때 반드시 피해요">알레르기</Label>
          <Chips name="allergies" options={ALLERGIES} checked={p.allergies ?? []} />
          <input name="allergy_other" placeholder="그 밖의 알레르기 (선택)" className={`${inputCls} mt-2`} />
          <Label hint="가능하면 피해서 식당을 골라요">덜 좋아하는 음식</Label>
          <Chips name="food_dislikes" options={DISLIKES} checked={p.food_dislikes ?? []} />
          <input name="dislike_other" placeholder="그 밖에 (선택)" className={`${inputCls} mt-2`} />
          <Label>식사 예산</Label>
          <Chips name="budget_ranges" options={BUDGETS} checked={p.budget_ranges ?? []} />
        </Card>

        <Card>
          <Label hint="신청할 때마다 바꿀 수 있어요">매칭이 안 되면 어떻게 할까요?</Label>
          <div className="space-y-2">
            {FAIL_PREFS.map((f) => (
              <label key={f.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="default_fail_pref" value={f.value}
                       defaultChecked={(p.default_fail_pref ?? "MOVE_DATE") === f.value} className="accent-[#B9784A]" />
                {f.label}
              </label>
            ))}
          </div>
        </Card>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="privacy" required defaultChecked={!!p.privacy_agreed_at} className="mt-1 accent-[#B9784A]" />
          <span>개인정보 수집·이용과 운영 정책(환불·노쇼 규정)에 동의해요. 매칭이 확정되면 같은 테이블 참가자와 앱 단체방에서 대화할 수 있어요.</span>
        </label>
        <Submit>{profile ? "저장하기" : "저장하고 신청하러 가기"}</Submit>
      </form>
    </Page>
  );
}

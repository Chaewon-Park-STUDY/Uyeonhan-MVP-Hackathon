import { redirect } from "next/navigation";
import { Card, Chips, ErrorBox, Label, Page, Submit, inputCls } from "@/components/ui";
import { ALLERGIES, ANIMALS, BUDGETS, DISLIKES, FAIL_PREFS, INTERESTS, MBTI_AXES, WANT_EXTRA, animalOf } from "@/lib/labels";
import { AnimalCards } from "@/components/animal-cards";
import { getMe } from "@/lib/supabase/server";
import { saveProfile } from "./actions";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { user, profile } = await getMe();
  if (!user) redirect("/login?next=/onboarding");
  const p = profile ?? {};
  const thisYear = new Date().getFullYear();

  return (
    <Page title={profile ? "프로필 수정" : "나를 소개해 주세요"} back={profile ? "/profile" : undefined}>
      <p className="-mt-3 mb-5 text-sm text-[#7A5E4B]">
        잘 맞는 테이블을 만드는 데만 쓰여요. 다른 참가자에게는 연락처·출생연도가 공개되지 않아요.
      </p>
      <ErrorBox message={error} />
      <form action={saveProfile} className="space-y-4">
        <input type="hidden" name="return_to" value={profile ? "/profile?saved=1" : "/apply"} />
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
            <input name="job" defaultValue={p.job ?? ""} placeholder="직업 (선택, 예: 마케터)" className={inputCls} />
          </div>
        </Card>

        <Card>
          <Label hint="네 가지 모두 골라 주세요. 테이블 분위기의 균형을 맞추는 데 써요">MBTI</Label>
          <div className="space-y-3">
            {MBTI_AXES.map((axis, i) => (
              <div key={axis.name}>
                <p className="mb-1.5 text-xs text-[#9A7B66]">{axis.title}</p>
                <div className="grid grid-cols-2 gap-2">
                  {axis.options.map(([letter, word, desc]) => (
                    <label key={letter} className="cursor-pointer">
                      <input type="radio" name={axis.name} value={letter} required
                             defaultChecked={(p.mbti ?? "")[i] === letter} className="peer sr-only" />
                      <span className="block h-full rounded-xl border border-[#E8DCCD] bg-[#FFFDF9] px-3 py-2.5 peer-checked:border-[#B9784A] peer-checked:bg-[#B9784A] peer-checked:text-white">
                        <b>{letter}</b> <span className="text-sm">{word}</span>
                        <span className="mt-0.5 block text-[11px] opacity-75">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <Label hint="하나 이상 골라 주세요 (여러 개 가능)">요즘 관심사</Label>
          <Chips name="interests" options={INTERESTS} checked={p.interests ?? []} />
        </Card>

        <Card className="bg-[#FFF8F0]">
          <p className="text-xs font-semibold tracking-widest text-[#B9784A]">ANIMAL CARD</p>
          <Label hint="1~2장 골라 주세요. 같은 테이블 사람들에게 내 카드가 보여요">나와 닮은 동물은?</Label>
          <AnimalCards name="self_traits" cards={ANIMALS} checked={p.self_traits ?? []} max={2} />
          <Label hint="1~3장 골라 주세요. 이 동물들과 같은 테이블이 되도록 매칭해요">함께하고 싶은 동물은?</Label>
          <AnimalCards name="desired_traits" cards={[...ANIMALS, ...WANT_EXTRA]} max={3}
                       checked={(p.desired_traits ?? []).map((v: string) => animalOf(v)?.value ?? v)} />
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

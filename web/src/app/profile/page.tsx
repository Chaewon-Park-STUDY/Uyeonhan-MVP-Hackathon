import { redirect } from "next/navigation";
import { ButtonLink, Card, Page } from "@/components/ui";
import { FAIL_PREFS, animalOf, byRarity } from "@/lib/labels";
import { AnimalBadge } from "@/components/animal-cards";
import { ProfileSummary } from "@/components/profile-summary";
import { getMe } from "@/lib/supabase/server";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const { user, profile: p } = await getMe();
  if (!user) redirect("/login?next=/profile");
  if (!p) redirect("/onboarding");

  const clean = (xs: string[] | null) => (xs ?? []).map((x) => x.replace(/^기타:/, ""));
  const failPref = FAIL_PREFS.find((f) => f.value === p.default_fail_pref)?.label;

  return (
    <Page title="내 프로필" back="/">
      {saved && <p className="mb-4 rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">저장했어요.</p>}

      <ProfileSummary p={p} />

      <Card className="mt-4 space-y-4">
        <div>
          <p className="mb-1.5 text-xs text-[#8B6A66]">나와 닮은 동물</p>
          <div className="flex flex-wrap gap-1.5">{byRarity(p.self_traits).map((v: string) => <AnimalBadge key={v} card={animalOf(v)} />)}</div>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-[#8B6A66]">함께하고 싶은 동물</p>
          <div className="flex flex-wrap gap-1.5">{(p.desired_traits ?? []).map((v: string) => <AnimalBadge key={v} card={animalOf(v)} />)}</div>
        </div>
      </Card>

      <Card className="mt-4 space-y-4">
        <Row title="알레르기" items={clean(p.allergies)} empty="없음" />
        <Row title="덜 좋아하는 음식" items={clean(p.food_dislikes)} empty="없음" />
        <Row title="식사 예산" items={p.budget_ranges} empty="상관 없음" />
        <div>
          <p className="mb-1 text-xs text-[#8B6A66]">매칭이 안 되면 (기본값)</p>
          <p className="text-sm">{failPref}</p>
        </div>
      </Card>

      <Card className="mt-4 text-xs text-[#8B6A66]">
        <p>같은 테이블 참가자에게는 <b>이름 첫 글자, 연령대, MBTI, 관심사, 나와 닮은 동물</b>만 보여요.</p>
        <p className="mt-1">연락처·출생연도·직업·음식 정보는 매칭과 식당 선정에만 쓰여요.</p>
      </Card>

      <div className="mt-5">
        <ButtonLink href="/onboarding">프로필 수정하기</ButtonLink>
      </div>
    </Page>
  );
}

function Row({ title, items, empty = "-" }: { title: string; items: string[] | null; empty?: string }) {
  const xs = items ?? [];
  return (
    <div>
      <p className="mb-1.5 text-xs text-[#8B6A66]">{title}</p>
      {xs.length === 0 ? (
        <p className="text-sm">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {xs.map((x) => <span key={x} className="rounded-full border border-[#E9DCD3] px-2.5 py-1 text-xs">{x}</span>)}
        </div>
      )}
    </div>
  );
}

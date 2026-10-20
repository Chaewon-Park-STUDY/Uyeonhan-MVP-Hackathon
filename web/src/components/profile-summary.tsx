import Link from "next/link";
import { Card } from "@/components/ui";
import { ageBand, animalOf, byRarity, mainAnimal } from "@/lib/labels";

type P = { name: string; birth_year: number; gender: string; job: string | null; mbti: string | null; interests: string[] | null;
  self_traits?: string[] | null };

// 홈 화면과 프로필 화면에서 같이 쓰는 요약 카드
export function ProfileSummary({ p, editHref }: { p: P; editHref?: string }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {(p.self_traits ?? []).length > 0 && (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#FFF3E6] text-3xl leading-none">
              {mainAnimal(p.self_traits)?.emoji}
            </span>
          )}
          <div>
          <p className="text-lg font-bold">{p.name}</p>
          <p className="mt-0.5 text-sm text-[#7A5E4B]">
            {ageBand(p.birth_year)} · {p.gender === "F" ? "여성" : "남성"}
            {p.mbti ? ` · ${p.mbti}` : ""}
            {p.job ? ` · ${p.job}` : ""}
          </p>
          {(p.self_traits ?? []).length > 0 && (
            <p className="mt-0.5 text-xs text-[#B9784A]">{byRarity(p.self_traits).slice(0, 2).map((v) => animalOf(v)?.name).filter(Boolean).join(" · ")}</p>
          )}
          </div>
        </div>
        {editHref && <Link href={editHref} className="shrink-0 whitespace-nowrap pl-2 text-sm text-[#B9784A]">내 프로필</Link>}
      </div>
      {(p.interests ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.interests!.map((i) => (
            <span key={i} className="rounded-full bg-[#F3E6D6] px-2.5 py-1 text-xs">{i}</span>
          ))}
        </div>
      )}
    </Card>
  );
}

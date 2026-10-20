import type { AnimalCard } from "@/lib/labels";

// 동물 카드 고르기 (체크박스, JS 없이 동작). 선택 개수 제한은 서버에서 검사
export function AnimalCards({ name, cards, checked = [] }: { name: string; cards: AnimalCard[]; checked?: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((c) => (
        <label key={c.value} className="cursor-pointer">
          <input type="checkbox" name={name} value={c.value} defaultChecked={checked.includes(c.value)} className="peer sr-only" />
          <span className="relative flex h-full flex-col items-center rounded-2xl border-2 border-[#EFE4D6] bg-[#FFFDF9] px-2 pb-3 pt-4 text-center transition peer-checked:border-[#B9784A] peer-checked:bg-[#FFF3E6] peer-checked:[&_.check]:opacity-100 peer-focus-visible:ring-2 peer-focus-visible:ring-[#B9784A]">
            <span className="check absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#B9784A] text-[11px] text-white opacity-0">✓</span>
            <span className="text-4xl leading-none">{c.emoji}</span>
            <span className="mt-2 text-sm font-bold">{c.name}</span>
            <span className="mt-0.5 text-[11px] text-[#9A7B66]">{c.desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// 작은 배지 (프로필·테이블 소개용)
export function AnimalBadge({ card }: { card?: AnimalCard }) {
  if (!card) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#F3E6D6] px-2.5 py-1 text-xs">
      <span>{card.emoji}</span>{card.name}
    </span>
  );
}

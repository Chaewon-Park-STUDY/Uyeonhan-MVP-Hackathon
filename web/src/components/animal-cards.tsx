"use client";

import { useState } from "react";
import type { AnimalCard } from "@/lib/labels";

// 동물 카드 고르기: 최대 개수까지 고르면 나머지는 잠김 (저장 후 오류로 입력이 날아가는 일 방지)
export function AnimalCards({ name, cards, checked = [], max }: {
  name: string; cards: AnimalCard[]; checked?: string[]; max: number;
}) {
  const [picked, setPicked] = useState<string[]>(checked.filter((v) => cards.some((c) => c.value === v)).slice(0, max));
  const full = picked.length >= max;
  const toggle = (v: string) =>
    setPicked((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= max ? cur : [...cur, v]));

  return (
    <div>
      <p className="mb-2 text-right text-xs text-[#9A7B66]">
        <b className={picked.length ? "text-[#B9784A]" : ""}>{picked.length}</b> / {max}장
        {full && " · 바꾸려면 고른 카드를 한 번 더 눌러 빼 주세요"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const on = picked.includes(c.value);
          const locked = full && !on;
          return (
            <label key={c.value} className={locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"}>
              <input type="checkbox" name={name} value={c.value} checked={on} disabled={locked}
                     onChange={() => toggle(c.value)} className="peer sr-only" />
              <span className={`relative flex h-full flex-col items-center rounded-2xl border-2 px-2 pb-3 pt-4 text-center transition peer-focus-visible:ring-2 peer-focus-visible:ring-[#B9784A] ${
                on ? "border-[#B9784A] bg-[#FFF3E6]" : "border-[#EFE4D6] bg-[#FFFDF9]"}`}>
                {on && (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#B9784A] text-[11px] text-white">
                    {picked.indexOf(c.value) + 1}
                  </span>
                )}
                <span className="text-4xl leading-none">{c.emoji}</span>
                <span className="mt-2 text-sm font-bold">{c.name}</span>
                <span className="mt-0.5 text-[11px] text-[#9A7B66]">{c.desc}</span>
              </span>
            </label>
          );
        })}
      </div>
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

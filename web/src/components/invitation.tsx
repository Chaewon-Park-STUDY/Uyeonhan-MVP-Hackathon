"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Arch, DiamondRule, WaxSeal } from "./brand";
import { TableIllustration } from "./table-illustration";

type Stage = "closed" | "opening" | "open";
const SEEN_KEY = "uy_invite_opened";

// 첫 화면: 왁스 실링이 찍힌 봉투 → 실링을 누르면 봉투가 열리고 초대장이 올라온다
// 한 번 열어 본 사람은 다음 방문 때 바로 펼쳐진 초대장을 본다 (localStorage, 실패해도 동작)
export function Invitation({ nextDate, regions }: { nextDate: string | null; regions: string[] }) {
  const [stage, setStage] = useState<Stage>("closed");

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) setStage("open");
    } catch { /* 저장소를 못 쓰면 매번 봉투부터 */ }
  }, []);

  function open() {
    if (stage !== "closed") return;
    setStage("opening");
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* 무시 */ }
    setTimeout(() => setStage("open"), 900);
  }

  if (stage !== "open") {
    return (
      <section className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center bg-gradient-to-b from-[#5E1520] to-[#7A1F2B] px-6 text-center text-[#FBF7F0]">
        <p className="animate-shimmer font-serif text-sm tracking-[0.3em] text-[#E6C56A]">INVITATION</p>
        <p className="mt-2 font-serif text-xl">당신에게 초대장이 도착했어요</p>

        <button type="button" onClick={open} aria-label="실링을 눌러 초대장 열기"
                className="relative mt-10 h-[200px] w-[300px] max-w-full [perspective:800px] focus:outline-none">
          {/* 봉투 몸통 */}
          <span className="absolute inset-0 rounded-md bg-[#F4E4DE] shadow-2xl" />
          <span className="absolute inset-x-0 bottom-0 h-[120px] rounded-b-md bg-[#EBD3CA] [clip-path:polygon(0_100%,50%_15%,100%_100%)]" />
          {/* 덮개 */}
          <span className={`absolute inset-x-0 top-0 h-[120px] origin-top rounded-t-md bg-[#E3C4B9] [clip-path:polygon(0_0,100%_0,50%_100%)] [backface-visibility:hidden] ${stage === "opening" ? "animate-flap" : ""}`} />
          {/* 왁스 실링 */}
          <span className={`absolute left-1/2 top-[78px] -translate-x-1/2 drop-shadow-lg transition-transform hover:scale-105 ${stage === "opening" ? "animate-seal" : ""}`}>
            <WaxSeal size={84} />
          </span>
        </button>

        <p className="mt-8 text-sm text-[#F4E4DE]/80">{stage === "opening" ? "초대장을 펼치는 중…" : "실링을 눌러 열어 보세요"}</p>
        <button type="button" onClick={() => setStage("open")} className="mt-6 text-xs text-[#F4E4DE]/60 underline">
          건너뛰기
        </button>
      </section>
    );
  }

  return (
    <section className="bg-gradient-to-b from-[#3A0D14] via-[#5E1520] to-[#FBF7F0] px-4 pb-10 pt-8">
      {/* 공식 포스터처럼: 어두운 와인빛 바탕 + 크림 글씨 + 골드 장식 */}
      <article className="animate-rise mx-auto max-w-sm rounded-[28px] border border-[#C9A227]/60 bg-gradient-to-b from-[#2E0B11] to-[#4A121C] px-6 pb-8 pt-7 text-center text-[#F3E9D8] shadow-2xl">
        <div className="rounded-[20px] border border-[#C9A227]/40 px-4 pb-6 pt-4">
          <Arch className="mx-auto w-44 text-[#E6C56A]" />
          <p className="mt-1 flex items-center justify-center gap-2 font-brand text-sm tracking-wider text-[#F3E9D8]/90">
            <span className="h-1 w-1 rotate-45 bg-[#E6C56A]" />매주 목요일 저녁<span className="h-1 w-1 rotate-45 bg-[#E6C56A]" />
          </p>
          <h1 className="mt-3 font-brand text-6xl font-bold leading-[1.12] tracking-tight text-[#F3E9D8]">우연한<br />식탁</h1>
          <DiamondRule className="mx-6 mt-5 text-[#E6C56A]" />
          <p className="mt-4 font-brand text-lg leading-relaxed tracking-wider">처음 보는 사람들과<br />좋은 저녁 한 끼</p>
          <TableIllustration className="mx-auto mt-5 w-56" />

          <div className="mt-5 rounded-xl border border-[#C9A227]/30 bg-white/5 px-4 py-3 text-sm">
            {nextDate ? (
              <>
                <p className="text-[#F3E9D8]/80">당신의 자리를 마련해 두었어요</p>
                <p className="mt-1 font-brand text-base font-bold text-[#E6C56A]">{nextDate}</p>
              </>
            ) : (
              <p className="text-[#F3E9D8]/80">다음 식탁을 준비하고 있어요</p>
            )}
            <p className="mt-1 text-xs text-[#F3E9D8]/60">{regions.join(" · ")}</p>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-[#F3E9D8]/75">
            나이·성비·MBTI·관심사와 <b className="text-[#F3E9D8]">동물 카드</b>로<br />잘 맞는 4~6명을 한 식탁에 모셔요.
          </p>

          <Link href="/login?mode=signup"
                className="mt-6 block rounded-xl bg-[#E6C56A] px-4 py-3.5 font-semibold text-[#3A0D14] shadow-md hover:bg-[#F0D58A]">
            초대 수락하기
          </Link>
          <Link href="/login" className="mt-3 inline-block text-sm text-[#F3E9D8]/70 underline">이미 계정이 있어요 · 로그인</Link>
          <p className="mt-6 font-brand text-xs tracking-wide text-[#F3E9D8]/60">by Whatsup House</p>
        </div>
      </article>
    </section>
  );
}

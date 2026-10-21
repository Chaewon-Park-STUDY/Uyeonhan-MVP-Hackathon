"use client";

import { useState } from "react";

// 누르면 복사 (복사 안 되는 브라우저는 공유 창으로)
export function CopyButton({ text, label = "복사", shareTitle }: { text: string; label?: string; shareTitle?: string }) {
  const [done, setDone] = useState(false);
  async function onClick() {
    try {
      if (shareTitle && typeof navigator !== "undefined" && "share" in navigator && /Mobi/i.test(navigator.userAgent)) {
        await navigator.share({ title: shareTitle, text, url: text.startsWith("http") ? text : undefined });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* 사용자가 취소 */
    }
  }
  return (
    <button type="button" onClick={onClick}
            className="shrink-0 rounded-lg border border-[#E9DCD3] bg-white px-3 py-1.5 text-xs font-semibold text-[#7A1F2B]">
      {done ? "복사됐어요 ✓" : label}
    </button>
  );
}

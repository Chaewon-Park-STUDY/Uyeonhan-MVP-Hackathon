"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// 폼 제출 중에는 버튼을 막고 "처리 중…" 표시 (서버가 느릴 때 여러 번 누르는 것 방지)
export function PendingButton({ children, className = "", pendingText = "처리 중…" }: {
  children: ReactNode; className?: string; pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}
            className={`${className} disabled:cursor-wait disabled:opacity-60`}>
      {pending ? pendingText : children}
    </button>
  );
}

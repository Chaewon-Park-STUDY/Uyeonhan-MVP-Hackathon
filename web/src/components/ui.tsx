import Link from "next/link";
import type { ReactNode } from "react";
import { PendingButton } from "./pending";

export function Page({ title, back, children }: { title?: string; back?: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
      {back && (
        <Link href={back} className="mb-3 inline-block text-sm text-[#9A7B66]">
          ← 돌아가기
        </Link>
      )}
      {title && <h1 className="mb-5 text-2xl font-bold">{title}</h1>}
      {children}
    </main>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(74,52,38,0.08)] ${className}`}>{children}</section>;
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 mt-5 first:mt-0">
      <p className="font-semibold">{children}</p>
      {hint && <p className="text-xs text-[#9A7B66]">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-[#E8DCCD] bg-[#FFFDF9] px-4 py-3 outline-none focus:border-[#B9784A]";

export function Chips({ name, options, checked = [], type = "checkbox" }: {
  name: string; options: readonly string[]; checked?: string[]; type?: "checkbox" | "radio";
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o} className="cursor-pointer">
          <input type={type} name={name} value={o} defaultChecked={checked.includes(o)} className="peer sr-only" />
          <span className="inline-block rounded-full border border-[#E8DCCD] bg-[#FFFDF9] px-3 py-1.5 text-sm peer-checked:border-[#B9784A] peer-checked:bg-[#B9784A] peer-checked:text-white">
            {o}
          </span>
        </label>
      ))}
    </div>
  );
}

export function Submit({ children, tone = "primary" }: { children: ReactNode; tone?: "primary" | "ghost" }) {
  const cls =
    tone === "primary"
      ? "bg-[#B9784A] text-white hover:bg-[#A4673C]"
      : "border border-[#E8DCCD] bg-white text-[#4A3426] hover:bg-[#FFFDF9]";
  return <PendingButton className={`w-full rounded-xl px-4 py-3.5 font-semibold ${cls}`}>{children}</PendingButton>;
}

export function ButtonLink({ href, children, tone = "primary" }: { href: string; children: ReactNode; tone?: "primary" | "ghost" }) {
  const cls =
    tone === "primary"
      ? "bg-[#B9784A] text-white hover:bg-[#A4673C]"
      : "border border-[#E8DCCD] bg-white text-[#4A3426] hover:bg-[#FFFDF9]";
  return <Link href={href} className={`block w-full rounded-xl px-4 py-3.5 text-center font-semibold ${cls}`}>{children}</Link>;
}

export function ErrorBox({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mb-4 rounded-xl bg-[#FCEDE8] px-4 py-3 text-sm text-[#A2412A]">{message}</p>;
}

export function Badge({ tone, children }: { tone: "wait" | "ok" | "warn" | "muted"; children: ReactNode }) {
  const cls = {
    wait: "bg-[#F3E6D6] text-[#7A5E4B]",
    ok: "bg-[#E3F1E4] text-[#2F6B3A]",
    warn: "bg-[#FCEDE8] text-[#A2412A]",
    muted: "bg-[#EEE9E4] text-[#8A7F77]",
  }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

// 신청 → 결제 → 매칭 대기 → 확정 진행 표시 (PRD STA-01)
export function Steps({ current }: { current: 0 | 1 | 2 | 3 }) {
  const steps = ["신청", "결제", "매칭 대기", "확정"];
  return (
    <ol className="my-3 flex items-center gap-1 text-[11px]">
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col items-center gap-1">
          <span className={`h-1.5 w-full rounded-full ${i <= current ? "bg-[#B9784A]" : "bg-[#EADFD2]"}`} />
          <span className={i <= current ? "font-semibold text-[#4A3426]" : "text-[#B3A398]"}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

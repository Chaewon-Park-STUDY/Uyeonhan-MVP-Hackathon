import Link from "next/link";
import type { ReactNode } from "react";

// 운영자 화면 공통 조각
export const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
export const todayKst = () => kstDate(new Date().toISOString());
export const shortDt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

export function AdminTitle({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">{title}</h1>
        {children}
      </div>
      {desc && <p className="mt-1 text-sm text-[#8B6A66]">{desc}</p>}
    </div>
  );
}

// 필터 칩 (현재 값은 진하게)
export function FilterChips({ base, param, options, current, keep = {} }: {
  base: string; param: string; options: [string, string][]; current?: string; keep?: Record<string, string | undefined>;
}) {
  const href = (v: string) => {
    const q = new URLSearchParams(Object.entries({ ...keep, [param]: v }).filter(([, x]) => x) as [string, string][]);
    return `${base}?${q.toString()}`;
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <Link key={v || "all"} href={href(v)}
              className={`rounded-full px-3 py-1 text-sm ${(current ?? "") === v ? "bg-[#7A1F2B] text-white" : "border border-[#E9DCD3] bg-white"}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "ok" }) {
  const c = tone === "warn" ? "text-[#A2412A]" : tone === "ok" ? "text-[#2F6B3A]" : "text-[#7A1F2B]";
  return (
    <div className="rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
      <p className="text-xs text-[#8B6A66]">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold ${c}`}>{value}</p>
    </div>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "warn" | "wait" | "muted" | "info" }) {
  const c = {
    ok: "bg-[#E3F1E4] text-[#2F6B3A]", warn: "bg-[#FCEDE8] text-[#A2412A]", wait: "bg-[#FDEFC8] text-[#8A5B00]",
    muted: "bg-[#EEE9E4] text-[#6A5F57]", info: "bg-[#DDE9F7] text-[#2C5687]",
  }[tone];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

export function TableWrap({ children, min = 760 }: { children: ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
      <table className="w-full text-sm" style={{ minWidth: min }}>{children}</table>
    </div>
  );
}

export const th = "py-2 pr-3 text-left text-xs font-medium text-[#8B6A66]";
export const td = "border-t border-[#F4ECE6] py-2 pr-3 align-top";

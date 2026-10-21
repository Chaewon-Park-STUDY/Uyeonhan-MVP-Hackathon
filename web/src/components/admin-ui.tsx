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

// 쪽 나누기: 긴 목록은 한 쪽에 20개씩
export function Pager({ base, page, total, size = 20, keep = {} }: {
  base: string; page: number; total: number; size?: number; keep?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...keep, page: String(p) }).filter(([, x]) => x) as [string, string][]);
    return `${base}?${q.toString()}`;
  };
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 text-sm">
      {page > 1 && <Link href={href(page - 1)} className="rounded-full border border-[#E9DCD3] bg-white px-3 py-1">← 이전</Link>}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1.5">
          {i > 0 && n - nums[i - 1] > 1 && <span className="text-[#B7A3A0]">…</span>}
          <Link href={href(n)} className={`rounded-full px-3 py-1 ${n === page ? "bg-[#7A1F2B] text-white" : "border border-[#E9DCD3] bg-white"}`}>{n}</Link>
        </span>
      ))}
      {page < pages && <Link href={href(page + 1)} className="rounded-full border border-[#E9DCD3] bg-white px-3 py-1">다음 →</Link>}
      <span className="ml-2 text-xs text-[#8B6A66]">{total}건 중 {(page - 1) * size + 1}~{Math.min(total, page * size)}</span>
    </div>
  );
}

// 필터 묶음: 왼쪽에 이름, 오른쪽에 버튼들
export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-xs font-semibold text-[#8B6A66]">{label}</span>
      {children}
    </div>
  );
}

// 성별·나이 배지 (사람 목록 공통)
export function GenderTag({ gender, birthYear }: { gender?: string | null; birthYear?: number | null }) {
  if (!gender) return null;
  const f = gender === "F";
  return (
    <span className={`ml-1.5 inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 align-middle text-[11px] font-semibold ${f ? "bg-[#FCE4EC] text-[#C2185B]" : "bg-[#E3F2FD] text-[#1565C0]"}`}>
      {f ? "여" : "남"}{birthYear ? ` · ${new Date().getFullYear() - birthYear}세` : ""}
    </span>
  );
}

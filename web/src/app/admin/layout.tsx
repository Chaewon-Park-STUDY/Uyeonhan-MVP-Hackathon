import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

const TABS = [
  ["/admin", "대시보드"],
  ["/admin/exceptions", "예외함"],
  ["/admin/tables", "테이블"],
  ["/admin/slots", "회차·식당"],
  ["/admin/settings", "설정"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="font-serif text-xl font-bold text-[#7A1F2B]">운영 관리</p>
        <nav className="flex flex-wrap gap-1.5 text-sm">
          {TABS.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-full border border-[#E9DCD3] bg-white px-3 py-1.5 hover:border-[#7A1F2B]">
              {label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}

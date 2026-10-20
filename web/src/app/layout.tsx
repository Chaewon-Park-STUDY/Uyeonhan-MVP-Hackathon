import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BrandSymbol, Wordmark } from "@/components/brand";
import { PendingButton } from "@/components/pending";
import { getMe } from "@/lib/supabase/server";
import { signOut } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "우연한 식탁",
  description: "처음 보는 사람들과 좋은 저녁 한 끼 — 성향이 맞는 4~6명을 한 식탁으로",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FBF7F0" };

async function Header() {
  const { supabase, user, profile } = await getMe();
  const { count: unread } = user && profile
    ? await supabase.from("notifications").select("id", { count: "exact", head: true })
        .eq("user_id", profile.id).not("sent_at", "is", null).is("read_at", null)
    : { count: 0 };
  return (
    <header className="sticky top-0 z-10 border-b border-[#EFE3DC] bg-[#FBF7F0]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-1.5 text-[#7A1F2B]">
          <BrandSymbol className="h-6 w-9" laurel={false} />
          <Wordmark className="text-lg" />
        </Link>
        {user ? (
          <nav className="flex items-center gap-3 text-sm">
            {profile?.role === "admin" && <Link href="/admin" className="font-semibold text-[#7A1F2B]">운영</Link>}
            <Link href="/apply">신청하기</Link>
            <Link href="/notifications" className="relative">
              알림
              {!!unread && (
                <span className="absolute -right-3 -top-1.5 rounded-full bg-[#7A1F2B] px-1.5 text-[10px] font-bold text-white">{unread}</span>
              )}
            </Link>
            <Link href="/profile">내 프로필</Link>
            <form action={signOut}>
              <PendingButton className="text-[#8B6A66]" pendingText="나가는 중…">로그아웃</PendingButton>
            </form>
          </nav>
        ) : (
          <Link href="/login" className="text-sm font-semibold text-[#7A1F2B]">로그인</Link>
        )}
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">
        <Header />
        {children}
      </body>
    </html>
  );
}

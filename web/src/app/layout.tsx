import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { PendingButton } from "@/components/pending";
import { getMe } from "@/lib/supabase/server";
import { signOut } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "우연한 식탁",
  description: "처음 보는 사람들과 좋은 저녁 한 끼 — 성향이 맞는 4~6명을 한 식탁으로",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FBF6EE" };

async function Header() {
  const { user } = await getMe();
  return (
    <header className="sticky top-0 z-10 border-b border-[#EFE4D6] bg-[#FBF6EE]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        <Link href="/" className="font-bold tracking-tight">우연한 식탁</Link>
        {user ? (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/apply">신청하기</Link>
            <Link href="/profile">내 프로필</Link>
            <form action={signOut}>
              <PendingButton className="text-[#9A7B66]" pendingText="나가는 중…">로그아웃</PendingButton>
            </form>
          </nav>
        ) : (
          <Link href="/login" className="text-sm font-semibold text-[#B9784A]">로그인</Link>
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

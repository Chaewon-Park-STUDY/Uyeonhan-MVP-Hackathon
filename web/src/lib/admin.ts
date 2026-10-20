import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/supabase/server";

// 운영자만 통과. 아니면 홈으로
export async function requireAdmin() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/admin");
  if (me.profile?.role !== "admin") redirect("/?not_admin=1");
  return me;
}

// Python 엔진(/api/match, /api/learn) 호출 — 비밀키는 서버에서만 사용
export async function callEngine(path: "match" | "learn", query: Record<string, string> = {}) {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const host = prod ?? (await headers()).get("host");
  const proto = host?.startsWith("localhost") ? "http" : "https";
  const qs = new URLSearchParams(query).toString();
  try {
    const res = await fetch(`${proto}://${host}/api/${path}${qs ? `?${qs}` : ""}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MATCH_SECRET ?? ""}` },
      cache: "no-store",
      signal: AbortSignal.timeout(55000),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    return { error: String(e) };
  }
}

export const FEATURE_LABEL: Record<string, string> = {
  gender: "성비 균형", mbti: "성향(외향·내향) 균형", interest: "관심사가 겹침", desired: "원하는 동물이 있음", novelty: "처음 만나는 사이",
};

export const EXCEPTION_LABEL: Record<string, string> = {
  PAYMENT: "결제", DATA: "데이터", VENUE: "식당", CONFLICT: "인원·충돌", NOTIFY: "알림", REFUND: "환불", SAFETY: "안전·신고",
};

// 학습 결과의 확실한 정도 (표준편차 → 쉬운 말)
export function certainty(sd: number) {
  if (sd < 0.12) return { label: "확실해요", tone: "text-[#2F6B3A]" };
  if (sd < 0.25) return { label: "어느 정도", tone: "text-[#9C7A12]" };
  return { label: "아직 데이터 부족", tone: "text-[#8B6A66]" };
}

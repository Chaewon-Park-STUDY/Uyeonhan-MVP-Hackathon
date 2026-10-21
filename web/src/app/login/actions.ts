"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function back(mode: string, msg: string, next: string) {
  redirect(`/login?mode=${mode}&error=${encodeURIComponent(msg)}&next=${encodeURIComponent(next)}`);
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") || "/");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) back("signin", "이메일 또는 비밀번호가 맞지 않아요.", next);
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (password.length < 6) back("signup", "비밀번호는 6자 이상이어야 해요.", "/onboarding");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) back("signup", error.message.includes("registered") ? "이미 가입된 이메일이에요." : "가입에 실패했어요.", "/onboarding");
  if (!data.session) back("signin", "가입 확인 메일을 보냈어요. 확인 후 로그인해 주세요.", "/onboarding");
  redirect("/onboarding");
}

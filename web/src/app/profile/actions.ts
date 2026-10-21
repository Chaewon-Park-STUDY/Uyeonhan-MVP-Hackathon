"use server";

import { redirect } from "next/navigation";
import { errorText } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

// 회원 탈퇴 (PRD §16 개인정보 삭제 요청): 연락처·직업·식사 정보 삭제, 로그인 계정 삭제
export async function deleteAccount(formData: FormData) {
  if (formData.get("confirm") !== "on") redirect(`/profile?error=${encodeURIComponent("안내를 확인했다는 체크를 해 주세요.")}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) redirect(`/profile?error=${encodeURIComponent(errorText(error.message))}`);
  await supabase.auth.signOut();
  redirect("/?bye=1");
}

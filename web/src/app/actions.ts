"use server";

import { redirect } from "next/navigation";
import { errorText } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

// STA-01: 매칭 전 신청 취소 (결제했으면 전액 자동 환불)
export async function cancelApplication(formData: FormData) {
  if (formData.get("confirm") !== "on") redirect(`/?error=${encodeURIComponent("'취소할게요'에 체크해 주세요.")}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_application", { p_app: String(formData.get("id")) });
  if (error) redirect(`/?error=${encodeURIComponent(errorText(error.message))}`);
  redirect("/?resolved=CANCELED");
}

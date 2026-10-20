"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errorText } from "@/lib/labels";

export async function saveProfile(formData: FormData) {
  const all = (k: string) => formData.getAll(k).map(String).filter(Boolean);
  const one = (k: string) => String(formData.get(k) ?? "").trim();
  const extraAllergy = one("allergy_other");
  const extraDislike = one("dislike_other");

  const payload = {
    name: one("name"),
    phone: one("phone"),
    birth_year: Number(one("birth_year")),
    gender: one("gender"),
    job: one("job"),
    mbti: ["mbti_ei", "mbti_sn", "mbti_tf", "mbti_jp"].map(one).join(""),
    interests: all("interests"),
    self_traits: all("self_traits"),
    desired_traits: all("desired_traits"),
    allergies: [...all("allergies"), ...(extraAllergy ? [`기타:${extraAllergy}`] : [])],
    food_dislikes: [...all("food_dislikes"), ...(extraDislike ? [`기타:${extraDislike}`] : [])],
    budget_ranges: all("budget_ranges"),
    default_fail_pref: one("default_fail_pref") || "MOVE_DATE",
    privacy_agreed: formData.get("privacy") === "on",
  };

  if (!payload.name || !payload.birth_year || !payload.gender) {
    redirect(`/onboarding?error=${encodeURIComponent("이름, 출생연도, 성별은 꼭 입력해 주세요.")}`);
  }
  if (!/^[EI][SN][TF][JP]$/.test(payload.mbti)) {
    redirect(`/onboarding?error=${encodeURIComponent("MBTI 네 가지를 모두 골라 주세요.")}`);
  }
  if (payload.interests.length === 0) {
    redirect(`/onboarding?error=${encodeURIComponent("관심사를 하나 이상 골라 주세요.")}`);
  }
  if (payload.self_traits.length < 1 || payload.self_traits.length > 2) {
    redirect(`/onboarding?error=${encodeURIComponent("나와 닮은 동물을 1~2장 골라 주세요.")}`);
  }
  if (payload.desired_traits.length < 1 || payload.desired_traits.length > 3) {
    redirect(`/onboarding?error=${encodeURIComponent("함께하고 싶은 동물을 1~3장 골라 주세요.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_my_profile", { p: payload });
  if (error) redirect(`/onboarding?error=${encodeURIComponent(errorText(error.message))}`);
  redirect(one("return_to") === "/profile?saved=1" ? "/profile?saved=1" : "/apply");
}

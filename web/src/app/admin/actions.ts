"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callEngine, requireAdmin } from "@/lib/admin";

// 매칭 미리 돌려보기(dry run) / 지금 실행
export async function runMatch(formData: FormData) {
  await requireAdmin();
  const date = String(formData.get("date"));
  const dry = formData.get("mode") !== "apply";
  if (!dry && formData.get("confirm") !== "on") redirect(`/admin?msg=${encodeURIComponent("실행 전 확인란을 체크해 주세요.")}`);
  const out = await callEngine("match", { date, ...(dry ? { dry_run: "1" } : {}) });
  revalidatePath("/admin");
  redirect(`/admin?result=${encodeURIComponent(JSON.stringify({ date, dry, out }))}`);
}

// 피드백으로 학습 → 사후분포 저장
export async function runLearn() {
  await requireAdmin();
  const out = await callEngine("learn");
  revalidatePath("/admin");
  redirect(`/admin?learn=${encodeURIComponent(String(out.status ?? out.error ?? "?"))}`);
}

// 예외 처리 완료
export async function resolveException(formData: FormData) {
  const { supabase, profile } = await requireAdmin();
  await supabase.from("exception_cases").update({
    status: "RESOLVED", resolved_at: new Date().toISOString(),
    admin_note: `${String(formData.get("note") ?? "").trim() || "처리 완료"} (by ${profile?.name})`,
  }).eq("id", String(formData.get("id")));
  revalidatePath("/admin/exceptions");
  revalidatePath("/admin");
}

// 회차 열기/닫기, 식당 켜기/끄기
export async function toggleSlot(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("event_slots").update({ is_open: formData.get("open") === "1" }).eq("id", String(formData.get("id")));
  revalidatePath("/admin/slots");
}

export async function toggleVenue(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("venues").update({ is_active: formData.get("active") === "1" }).eq("id", String(formData.get("id")));
  revalidatePath("/admin/slots");
}

// 설정 저장 (매칭 가중치·정책·시연 모드·노쇼 보상)
export async function saveSettings(formData: FormData) {
  const { supabase } = await requireAdmin();
  const num = (k: string, d: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) ? v : d;
  };
  const { data: rows } = await supabase.from("settings").select("key, value").in("key", ["matching", "demo", "no_show_sanction"]);
  const cur = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value])) as Record<string, Record<string, unknown>>;

  const weights = Object.fromEntries(["gender", "mbti", "interest", "desired", "novelty"].map((k) => [k, Math.max(0, num(`w_${k}`, 0))]));
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(weights)) weights[k] = Math.round((weights[k] / total) * 1000) / 1000;   // 합 1로 정규화

  const matching = { ...cur.matching, weights, min_score: num("min_score", 0.45), max_age_gap: num("max_age_gap", 8),
    policy: formData.get("policy") === "thompson" ? "thompson" : "mean" };
  const demo = { ...cur.demo, feedback_anytime: formData.get("demo") === "on" };
  const nss = cur.no_show_sanction ?? {};
  const noShow = { ...nss, compensation: { ...(nss.compensation as object), enabled: formData.get("compensation") === "on" } };

  const now = new Date().toISOString();
  await supabase.from("settings").upsert([
    { key: "matching", value: matching, updated_at: now },
    { key: "demo", value: demo, updated_at: now },
    { key: "no_show_sanction", value: noShow, updated_at: now },
  ]);
  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}

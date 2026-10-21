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

  const matching = { ...cur.matching, weights, min_score: Math.min(1, Math.max(0, num("min_score", 45) / 100)), max_age_gap: num("max_age_gap", 8),
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

// 신고 조치 (PRD SAF-02): 경고 / 30일 참가 제한 / 영구 제한 / 조치 없음
export async function safetyAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.rpc("admin_safety_action", {
    p_exception: String(formData.get("id")), p_action: String(formData.get("action")), p_note: String(formData.get("note") ?? ""),
  });
  revalidatePath("/admin/exceptions");
  revalidatePath("/admin");
}

// 참석 관리: 노쇼 후보 → 참석 / 노쇼 확정
export async function setAttendance(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.rpc("admin_set_attendance", {
    p_table: String(formData.get("table")), p_user: String(formData.get("user")), p_status: String(formData.get("status")),
  });
  revalidatePath("/admin/attendance");
}

// 회차 만들기: 날짜·시간·지역·정원·마감·자동 매칭 시각
export async function createSlot(formData: FormData) {
  const { supabase } = await requireAdmin();
  const date = String(formData.get("date"));
  const time = String(formData.get("time") || "19:30");
  const starts = new Date(`${date}T${time}:00+09:00`);
  // 기본: 모임 이틀 전 밤 12시(= 전날 00:00)에 신청 마감 + 자동 매칭
  const dflt = new Date(`${date}T00:00:00+09:00`).getTime() - 24 * 3600e3;
  const deadline = formData.get("deadline") ? new Date(`${formData.get("deadline")}:00+09:00`) : new Date(dflt);
  const regions = formData.getAll("region").map(String);
  if (!regions.length) redirect(`/admin/slots?err=${encodeURIComponent("지역을 하나 이상 골라 주세요.")}`);
  const errs: string[] = [];
  for (const region of regions) {
    const { error } = await supabase.rpc("admin_create_slot", {
      p_starts: starts.toISOString(), p_region: region, p_capacity: Number(formData.get("capacity")) || 30,
      p_deadline: deadline.toISOString(), p_match_run: deadline.toISOString(), p_tables_per_venue: Number(formData.get("tables")) || 2,
    });
    if (error) errs.push(error.message);
  }
  revalidatePath("/admin/slots");
  redirect(`/admin/slots?${errs.length ? `err=${encodeURIComponent(errs[0].includes("INVALID_SCHEDULE") ? "마감 시각은 모임 시작 전이어야 해요." : "만들지 못했어요.")}` : "made=1"}`);
}

// 식당 수용 테이블 수 (모집 중 회차 전체)
export async function setVenueCapacity(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.rpc("admin_set_venue_capacity", { p_venue: String(formData.get("id")), p_tables: Number(formData.get("tables")) || 1 });
  revalidatePath("/admin/slots");
}

// 자동 메시지 문구 수정 (비우면 기본 문구)
export async function saveMessage(formData: FormData) {
  const { supabase } = await requireAdmin();
  const code = String(formData.get("code"));
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const { data } = await supabase.from("settings").select("value").eq("key", "message_overrides").maybeSingle();
  const cur = { ...((data?.value as Record<string, unknown>) ?? {}) };
  if (title || body) cur[code] = { title, body };
  else delete cur[code];
  await supabase.from("settings").upsert({ key: "message_overrides", value: cur, updated_at: new Date().toISOString() });
  revalidatePath("/admin/messages");
  redirect("/admin/messages?saved=1");
}

// 식당 추가 (PRD §11 식당 재고 관리)
export async function createVenue(formData: FormData) {
  const { supabase } = await requireAdmin();
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const { data, error } = await supabase.from("venues").insert({
    name: s("name"), region_code: s("region"), address: s("address"), map_url: s("map_url") || null,
    price_range: s("price_range") || null, rating: Number(s("rating")) || null,
    menu_tags: formData.getAll("tags").map(String), is_active: true, is_reservable: true,
  }).select("id").single();
  if (error || !data) redirect(`/admin/slots?err=${encodeURIComponent("식당을 추가하지 못했어요. 이름·주소를 확인해 주세요.")}`);
  await supabase.rpc("admin_set_venue_capacity", { p_venue: data.id, p_tables: Number(s("tables")) || 2 });
  revalidatePath("/admin/slots");
  redirect("/admin/slots?venue=1");
}

// 처리대기함: 식당 직접 지정 / 결원 테이블 처리 / 안내 다시 보내기
export async function assignVenue(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.rpc("admin_assign_venue", { p_table: String(formData.get("table")), p_venue: String(formData.get("venue")) });
  revalidatePath("/admin/exceptions");
  revalidatePath("/admin");
}
export async function shortTable(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.rpc("admin_short_table", { p_table: String(formData.get("table")), p_mode: String(formData.get("mode")) });
  revalidatePath("/admin/exceptions");
  revalidatePath("/admin");
}
export async function retryNotify(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.rpc("admin_retry_notify", { p_table: String(formData.get("table")) });
  revalidatePath("/admin/exceptions");
}
// 식당 수용: 회차별
export async function setSlotCapacity(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.rpc("admin_set_slot_capacity", {
    p_venue: String(formData.get("venue")), p_slot: String(formData.get("slot")), p_tables: Number(formData.get("tables")) || 0,
  });
  revalidatePath("/admin/slots");
}

// 상담 챗봇 문의 확인 완료
export async function doneInquiry(formData: FormData) {
  const { supabase } = await requireAdmin();
  await supabase.from("inquiries").update({ status: "DONE", done_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  revalidatePath("/admin/feedback");
}

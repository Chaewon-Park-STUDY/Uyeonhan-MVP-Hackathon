"use server";

import { createClient as createAdmin } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorText } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { geminiTopics, templateTopics } from "@/lib/topics";

const MAX_TOPIC_MESSAGES = 4; // 처음 안내 1 + 추가 요청 3

// "대화 주제 더 받기": 멤버인지 확인 → Gemini(실패 시 템플릿) → 시스템 메시지로 단체방에 올림
export async function moreTopics(formData: FormData) {
  const tableId = String(formData.get("table_id"));
  const supabase = await createClient();
  const { data: info } = await supabase.rpc("table_info", { p_table_id: tableId }).maybeSingle<{
    room_id: string; shared_interests: string[] | null;
  }>();
  if (!info?.room_id) return;

  const { data: intro } = await supabase.rpc("table_intro", { p_table_id: tableId });
  const members = (intro ?? []) as { mbti: string | null }[];
  const { data: prev } = await supabase.from("chat_messages").select("content")
    .eq("room_id", info.room_id).eq("kind", "TOPIC");
  if ((prev?.length ?? 0) >= MAX_TOPIC_MESSAGES) return;

  const interests = info.shared_interests ?? [];
  const eCount = members.filter((m) => m.mbti?.startsWith("E")).length;
  const ai = await geminiTopics(interests, eCount, members.length);
  const topics = ai ?? templateTopics(interests, (prev ?? []).map((p) => p.content));
  const content = `${ai ? "AI가 고른" : "추천"} 대화 주제예요\n· ${topics.join("\n· ")}`;

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) redirect(`/table/${tableId}?error=${encodeURIComponent("지금은 대화 주제를 더 받을 수 없어요. 잠시 후 다시 시도해 주세요.")}`);
  const admin = createAdmin(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
  await admin.from("chat_messages").insert({ room_id: info.room_id, kind: "TOPIC", content });
  revalidatePath(`/table/${tableId}`);
}

// 도착 체크인 / 좌석 취소
export async function checkIn(formData: FormData) {
  const tableId = String(formData.get("table_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_in", { p_table: tableId });
  if (error) redirect(`/table/${tableId}?error=${encodeURIComponent(errorText(error.message))}`);
  revalidatePath(`/table/${tableId}`);
}

export async function cancelSeat(formData: FormData) {
  const tableId = String(formData.get("table_id"));
  if (formData.get("confirm") !== "on") redirect(`/table/${tableId}?error=${encodeURIComponent("취소하려면 확인란에 체크해 주세요.")}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_my_seat", { p_table: tableId });
  if (error) redirect(`/table/${tableId}?error=${encodeURIComponent(errorText(error.message))}`);
  revalidatePath(`/table/${tableId}`);
  revalidatePath("/");
}

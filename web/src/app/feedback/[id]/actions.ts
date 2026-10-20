"use server";

import { redirect } from "next/navigation";
import { errorText } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export async function submitFeedback(formData: FormData) {
  const tableId = String(formData.get("table_id"));
  const one = (k: string) => String(formData.get(k) ?? "").trim();
  const people = [...formData.keys()]
    .filter((k) => k.startsWith("p_"))
    .map((k) => ({ to: k.slice(2), kind: one(k) }))
    .filter((x) => x.kind && x.kind !== "NEUTRAL");

  const p: Record<string, unknown> = {
    table_score: Number(one("table_score")) || null,
    convo_score: one("convo_score"),
    venue_score: one("venue_score"),
    comment: one("comment"),
    people,
  };
  if (one("report_to") && one("report_reason")) p.report = { to: one("report_to"), reason: one("report_reason") };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_feedback", { p_table: tableId, p });
  if (error && !error.message.includes("ALREADY_SUBMITTED")) {
    redirect(`/feedback/${tableId}?error=${encodeURIComponent(errorText(error.message))}`);
  }
  if (!error) {
    await supabase.rpc("set_feedback_intents", {
      p_table: tableId, p_revisit: Number(one("revisit_intent")) || 0, p_recommend: Number(one("recommend_intent")) || 0,
    });
  }
  redirect(`/feedback/${tableId}/done`);
}

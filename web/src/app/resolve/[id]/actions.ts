"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errorText } from "@/lib/labels";

export async function resolve(formData: FormData) {
  const id = String(formData.get("id"));
  const [choice, slot] = String(formData.get("choice")).split(":");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_match", { p_app: id, p_choice: choice, p_slot: slot || null });
  if (error) redirect(`/resolve/${id}?error=${encodeURIComponent(errorText(error.message))}`);
  redirect(`/?resolved=${data}`);
}

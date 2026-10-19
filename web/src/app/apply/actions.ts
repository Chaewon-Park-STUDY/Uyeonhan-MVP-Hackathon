"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errorText } from "@/lib/labels";

export async function submitApplication(formData: FormData) {
  const slots = formData.getAll("slot").map(String);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_application", {
    p_slot_ids: slots,
    p_pass_type: String(formData.get("pass") || "SINGLE"),
    p_fail_pref: String(formData.get("fail_pref") || "MOVE_DATE"),
    p_coupon_id: (formData.get("coupon") as string) || null,
  });
  if (error) redirect(`/apply?error=${encodeURIComponent(errorText(error.message))}`);

  const { data: app } = await supabase.from("applications").select("payment_status").eq("id", data).single();
  redirect(app?.payment_status === "PAID" ? `/?done=${data}` : `/pay/${data}`);
}

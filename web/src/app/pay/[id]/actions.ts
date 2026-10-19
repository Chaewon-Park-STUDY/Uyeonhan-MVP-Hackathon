"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errorText } from "@/lib/labels";

export async function pay(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("mock_pay", { p_app: id });
  if (error) redirect(`/pay/${id}?error=${encodeURIComponent(errorText(error.message))}`);
  redirect(`/?done=${id}`);
}

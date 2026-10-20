import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { notiText } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";

type Noti = { id: string; template: string; payload: { table_id?: string; starts_at?: string; venue?: string; region?: string };
  sent_at: string; read_at: string | null };

export default async function NotificationsPage() {
  const { supabase, user } = await getMe();
  if (!user) redirect("/login?next=/notifications");

  const { data } = await supabase.from("notifications").select("id, template, payload, sent_at, read_at")
    .not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(50);
  const list = (data ?? []) as Noti[];
  await supabase.rpc("mark_notifications_read");

  return (
    <Page title="알림" back="/">
      {list.length === 0 && <Card><p className="text-sm text-[#8B6A66]">아직 받은 알림이 없어요.</p></Card>}
      <div className="space-y-2">
        {list.map((n) => {
          const t = notiText(n.template, n.payload);
          const href = n.template === "FEEDBACK_REQUEST" ? `/feedback/${n.payload.table_id}` : `/table/${n.payload.table_id}`;
          return (
            <Link key={n.id} href={href} className="block">
              <Card className={`py-4 ${n.read_at ? "" : "ring-1 ring-[#7A1F2B]"}`}>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{t.title}</p>
                  <span className="text-[11px] text-[#B7A3A0]">
                    {new Date(n.sent_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[#6A4A4C]">{t.body}</p>
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="mt-4 text-center text-xs text-[#B7A3A0]">시연 버전에서는 앱 알림과 단체방 메시지로 안내해요. (카카오 알림톡·문자는 실제 운영 시 연결)</p>
    </Page>
  );
}

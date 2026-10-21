import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { type MsgOverride, notiHref, notiTextWith } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";

type Noti = { id: string; template: string; payload: { table_id?: string; starts_at?: string; venue?: string; region?: string; match_run_at?: string; deadline?: string; amount?: number };
  sent_at: string; read_at: string | null };

export default async function NotificationsPage() {
  const { supabase, user, profile } = await getMe();
  if (!user) redirect("/login?next=/notifications");

  const { data } = await supabase.from("notifications").select("id, template, payload, sent_at, read_at")
    .eq("user_id", profile?.id ?? "").not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(50);
  const list = (data ?? []) as Noti[];
  const { data: overrides } = await supabase.rpc("message_overrides");
  // 이번에 처음 본 알림은 '새 알림'으로 보여 주고, 다음부터는 '읽은 알림'으로
  const unread = list.filter((n) => !n.read_at), read = list.filter((n) => n.read_at);
  await supabase.rpc("mark_notifications_read");
  const Item = ({ n }: { n: Noti }) => {
    const t = notiTextWith(overrides as Record<string, MsgOverride> | null, n.template, n.payload);
    return (
      <Link href={notiHref(n.template, n.payload)} className="block">
        <Card className={`py-4 ${n.read_at ? "" : "ring-1 ring-[#7A1F2B]"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 font-semibold">{!n.read_at && <span className="h-2 w-2 rounded-full bg-[#7A1F2B]" />}{t.title}</p>
            <span className="shrink-0 text-[11px] text-[#B7A3A0]">
              {new Date(n.sent_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <p className="mt-1 text-sm text-[#6A4A4C]">{t.body}</p>
        </Card>
      </Link>
    );
  };

  return (
    <Page title="알림" back="/">
      {list.length === 0 && <Card><p className="text-sm text-[#8B6A66]">아직 받은 알림이 없어요.</p></Card>}
      {unread.length > 0 && (
        <section className="mb-6">
          <p className="mb-2 text-sm font-semibold text-[#7A1F2B]">새 알림 {unread.length}</p>
          <div className="space-y-2">{unread.map((n) => <Item key={n.id} n={n} />)}</div>
        </section>
      )}
      {read.length > 0 && (
        <section>
          <p className="mb-2 text-sm font-semibold text-[#8B6A66]">읽은 알림 {read.length}</p>
          <div className="space-y-2 opacity-80">{read.map((n) => <Item key={n.id} n={n} />)}</div>
        </section>
      )}
    </Page>
  );
}

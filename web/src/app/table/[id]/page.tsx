import { notFound, redirect } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { REGION_LABEL, fmtDate } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { moreTopics } from "./actions";
import { ChatRoom, type Msg } from "./chat";

type Info = {
  starts_at: string; region_code: string; venue_name: string | null; venue_address: string | null;
  map_url: string | null; room_id: string | null; shared_interests: string[] | null;
};
type Intro = { nickname: string; age_band: string; mbti: string | null; interests: string[]; is_me: boolean };

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getMe();
  if (!user) redirect(`/login?next=/table/${id}`);

  const { data: info } = await supabase.rpc("table_info", { p_table_id: id }).maybeSingle<Info>();
  if (!info) notFound();

  const [{ data: intro }, { data: roster }, { data: msgs }] = await Promise.all([
    supabase.rpc("table_intro", { p_table_id: id }),
    supabase.rpc("table_roster", { p_table_id: id }),
    info.room_id
      ? supabase.from("chat_messages").select("id, sender_id, kind, content, created_at")
          .eq("room_id", info.room_id).order("id").limit(200)
      : Promise.resolve({ data: [] }),
  ]);
  const people = (intro ?? []) as Intro[];
  const topicCount = ((msgs ?? []) as Msg[]).filter((m) => m.kind === "TOPIC").length;
  const mapLink = info.map_url ?? (info.venue_name
    ? `https://map.naver.com/p/search/${encodeURIComponent(info.venue_name.replace(/^\[샘플\]\s*/, ""))}` : null);

  return (
    <Page back="/">
      <Card>
        <p className="text-xs text-[#9A7B66]">나의 테이블</p>
        <p className="mt-1 text-xl font-bold">{fmtDate(info.starts_at)}</p>
        <p className="mt-1 text-sm">{REGION_LABEL[info.region_code]} · 나 포함 {people.length}명</p>
        <div className="mt-3 rounded-xl bg-[#FFF8F0] px-3 py-2.5 text-sm">
          {info.venue_name ? (
            <>
              <p className="font-semibold">📍 {info.venue_name}</p>
              <p className="text-xs text-[#7A5E4B]">{info.venue_address}</p>
              {mapLink && <a href={mapLink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[#B9784A] underline">지도에서 보기</a>}
            </>
          ) : (
            <p className="text-[#7A5E4B]">식당은 운영자가 확인 중이에요. 정해지면 알려 드릴게요.</p>
          )}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {people.map((p, i) => (
            <li key={i} className={`rounded-xl border px-3 py-2 ${p.is_me ? "border-[#B9784A] bg-[#FFF8F0]" : "border-[#EFE4D6]"}`}>
              <b>{p.is_me ? "나" : p.nickname}</b> · {p.age_band}{p.mbti ? ` · ${p.mbti}` : ""}
              <p className="mt-0.5 truncate text-[#9A7B66]">{p.interests.slice(0, 2).join(", ")}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-semibold">단체방</h2>
        {info.room_id && topicCount < 4 && (
          <form action={moreTopics}>
            <input type="hidden" name="table_id" value={id} />
            <PendingButton className="rounded-full border border-[#E8DCCD] bg-white px-3 py-1.5 text-xs" pendingText="고르는 중…">
              💬 대화 주제 더 받기
            </PendingButton>
          </form>
        )}
      </div>
      {info.room_id ? (
        <ChatRoom roomId={info.room_id} initial={(msgs ?? []) as Msg[]}
                  roster={(roster ?? []) as { profile_id: string; nickname: string; is_me: boolean }[]} />
      ) : (
        <Card><p className="text-sm text-[#9A7B66]">단체방을 준비하고 있어요.</p></Card>
      )}
    </Page>
  );
}

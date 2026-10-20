import { notFound, redirect } from "next/navigation";
import { ButtonLink, Card, Page } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { REGION_LABEL, mainAnimal, fmtDate } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { cancelSeat, checkIn, moreTopics } from "./actions";
import { ChatRoom, type Msg } from "./chat";

type Info = {
  starts_at: string; region_code: string; venue_name: string | null; venue_address: string | null;
  map_url: string | null; room_id: string | null; shared_interests: string[] | null;
};
type Status = { attendance: string; checked_in_at: string | null; can_check_in: boolean; can_cancel: boolean;
  can_feedback: boolean; feedback_done: boolean; demo: boolean };
type Intro = { nickname: string; age_band: string; mbti: string | null; interests: string[]; is_me: boolean; animals?: string[] | null };

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getMe();
  if (!user) redirect(`/login?next=/table/${id}`);

  const { data: info } = await supabase.rpc("table_info", { p_table_id: id }).maybeSingle<Info>();
  if (!info) notFound();

  const [{ data: intro }, { data: roster }, { data: msgs }, { data: st }] = await Promise.all([
    supabase.rpc("table_intro", { p_table_id: id }),
    supabase.rpc("table_roster", { p_table_id: id }),
    info.room_id
      ? supabase.from("chat_messages").select("id, sender_id, kind, content, created_at, deleted_at")
          .eq("room_id", info.room_id).order("id").limit(200)
      : Promise.resolve({ data: [] }),
    supabase.rpc("my_table_status", { p_table: id }).maybeSingle<Status>(),
  ]);
  const people = (intro ?? []) as Intro[];
  const topicCount = ((msgs ?? []) as Msg[]).filter((m) => m.kind === "TOPIC").length;
  const mapLink = info.map_url ?? (info.venue_name
    ? `https://map.naver.com/p/search/${encodeURIComponent(info.venue_name.replace(/^\[샘플\]\s*/, ""))}` : null);

  return (
    <Page back="/">
      <Card>
        <p className="text-xs text-[#8B6A66]">나의 테이블</p>
        <p className="mt-1 text-xl font-bold">{fmtDate(info.starts_at)}</p>
        <p className="mt-1 text-sm">{REGION_LABEL[info.region_code]} · 나 포함 {people.length}명</p>
        <div className="mt-3 rounded-xl bg-[#FBF1EC] px-3 py-2.5 text-sm">
          {info.venue_name ? (
            <>
              <p className="font-semibold">📍 {info.venue_name}</p>
              <p className="text-xs text-[#6A4A4C]">{info.venue_address}</p>
              {mapLink && <a href={mapLink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[#7A1F2B] underline">지도에서 보기</a>}
            </>
          ) : (
            <p className="text-[#6A4A4C]">식당은 운영자가 확인 중이에요. 정해지면 알려 드릴게요.</p>
          )}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {people.map((p, i) => (
            <li key={i} className={`rounded-xl border px-3 py-2 ${p.is_me ? "border-[#7A1F2B] bg-[#FBF1EC]" : "border-[#EFE3DC]"}`}>
              <span className="mr-1">{mainAnimal(p.animals)?.emoji}</span><b>{p.is_me ? "나" : p.nickname}</b> · {p.age_band}{p.mbti ? ` · ${p.mbti}` : ""}
              <p className="mt-0.5 truncate text-[#8B6A66]">{p.interests.slice(0, 2).join(", ")}</p>
            </li>
          ))}
        </ul>
      </Card>

      {st && <StatusBar id={id} st={st} />}

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-semibold">단체방</h2>
        {info.room_id && topicCount < 4 && (
          <form action={moreTopics}>
            <input type="hidden" name="table_id" value={id} />
            <PendingButton className="rounded-full border border-[#E9DCD3] bg-white px-3 py-1.5 text-xs" pendingText="고르는 중…">
              💬 대화 주제 더 받기
            </PendingButton>
          </form>
        )}
      </div>
      {info.room_id ? (
        <ChatRoom roomId={info.room_id} initial={(msgs ?? []) as Msg[]}
                  roster={(roster ?? []) as { profile_id: string; nickname: string; is_me: boolean; animals?: string[] | null; age_band?: string }[]} />
      ) : (
        <Card><p className="text-sm text-[#8B6A66]">단체방을 준비하고 있어요.</p></Card>
      )}
    </Page>
  );
}

function StatusBar({ id, st }: { id: string; st: Status }) {
  if (st.attendance === "CANCELED_EARLY" || st.attendance === "CANCELED_LATE") {
    return <Card className="mt-4"><p className="text-sm text-[#6A4A4C]">이번 모임은 취소했어요. 환불 규정에 따라 환불되지 않아요.</p></Card>;
  }
  if (st.attendance === "NO_SHOW") {
    return <Card className="mt-4"><p className="text-sm text-[#A2412A]">노쇼로 기록됐어요. 90일 안에 2회가 쌓이면 30일간 신청이 제한돼요.</p></Card>;
  }
  return (
    <div className="mt-4 space-y-2">
      {st.can_feedback && !st.feedback_done && (
        <ButtonLink href={`/feedback/${id}`}>오늘 식탁 피드백 남기기 · 쿠폰 받기</ButtonLink>
      )}
      {st.feedback_done && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">피드백을 남겨 주셔서 고마워요. 재방문 쿠폰이 발급됐어요.</p>}
      {st.checked_in_at ? (
        <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">도착 체크인 완료 👋</p>
      ) : st.can_check_in && (
        <form action={checkIn}>
          <input type="hidden" name="table_id" value={id} />
          <PendingButton className="w-full rounded-xl border border-[#7A1F2B] bg-white px-4 py-3 font-semibold text-[#7A1F2B]">
            도착했어요 (체크인)
          </PendingButton>
        </form>
      )}
      {st.can_cancel && (
        <details className="rounded-xl bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer text-[#8B6A66]">못 가게 됐나요?</summary>
          <form action={cancelSeat} className="mt-3 space-y-2">
            <input type="hidden" name="table_id" value={id} />
            <p className="text-xs text-[#6A4A4C]">매칭이 확정된 뒤라 환불되지 않아요. 모임 당일 취소는 벌점 0.5점이 쌓여요. 미리 알려 주시면 남은 분들이 기다리지 않아요.</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="confirm" required className="accent-[#7A1F2B]" /> 위 내용을 확인했어요
            </label>
            <PendingButton className="w-full rounded-xl bg-[#A2412A] px-4 py-2.5 text-sm font-semibold text-white">참석 취소하기</PendingButton>
          </form>
        </details>
      )}
    </div>
  );
}

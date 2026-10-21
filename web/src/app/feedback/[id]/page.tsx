import { notFound, redirect } from "next/navigation";
import { ButtonLink, Card, ErrorBox, Label, Page, Submit, inputCls } from "@/components/ui";
import { REGION_LABEL, fmtDate, mainAnimal, venueName } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";
import { submitFeedback } from "./actions";

type Status = { can_feedback: boolean; feedback_done: boolean; demo: boolean };
type Member = { profile_id: string; nickname: string; is_me: boolean; age_band: string; mbti: string | null;
  interests: string[] | null; animals: string[] | null };
type Info = { starts_at: string; region_code: string; venue_name: string | null };

const SCORES = [
  ["1", "😞", "별로"], ["2", "😕", "아쉬움"], ["3", "🙂", "보통"], ["4", "😊", "좋음"], ["5", "🤩", "최고"],
] as const;
const PEOPLE = [
  ["LIKE", "또 만나고 싶어요"], ["NEUTRAL", "괜찮았어요"], ["AVOID", "다시는 안 만날래요"], ["ABSENT", "안 왔어요"],
] as const;

export default async function FeedbackPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, user } = await getMe();
  if (!user) redirect(`/login?next=/feedback/${id}`);

  const [{ data: st }, { data: info }, { data: roster }] = await Promise.all([
    supabase.rpc("my_table_status", { p_table: id }).maybeSingle<Status>(),
    supabase.rpc("table_info", { p_table_id: id }).maybeSingle<Info>(),
    supabase.rpc("table_roster", { p_table_id: id }),
  ]);
  if (!st || !info) notFound();
  if (st.feedback_done) redirect(`/feedback/${id}/done`);
  const others = ((roster ?? []) as (Member & { canceled?: boolean })[]).filter((m) => !m.is_me && !m.canceled);
  if (String((st as { attendance?: string }).attendance ?? "").startsWith("CANCELED")) {
    return (
      <Page title="피드백" back="/">
        <Card><p className="text-sm text-[#6A4A4C]">참석을 취소한 모임이라 피드백은 남기지 않아도 돼요. 다음 식탁에서 만나요!</p></Card>
      </Page>
    );
  }

  if (!st.can_feedback) {
    return (
      <Page title="피드백" back={`/table/${id}`}>
        <Card><p className="text-sm text-[#6A4A4C]">모임이 끝난 뒤에 남길 수 있어요. ({fmtDate(info.starts_at)})</p></Card>
      </Page>
    );
  }

  return (
    <Page title="오늘 식탁은 어땠나요?" back={`/table/${id}`}>
      <p className="-mt-3 mb-5 text-sm text-[#6A4A4C]">
        {fmtDate(info.starts_at)} · {info.venue_name ? venueName(info.venue_name) : REGION_LABEL[info.region_code]}
        <br />1분이면 끝나요. 남겨 주신 답은 다음 매칭을 더 잘 맞추는 데 쓰여요.
      </p>
      {st.demo && <p className="mb-4 rounded-xl bg-[#F4E4DE] px-3 py-2 text-xs">지금은 모임 전에도 피드백을 미리 남겨 볼 수 있게 열려 있어요.</p>}
      <ErrorBox message={error} />

      <form action={submitFeedback} className="space-y-4">
        <input type="hidden" name="table_id" value={id} />
        <Card>
          <Label hint="꼭 골라 주세요">테이블 전체 만족도 <span className="text-[#A2412A]">*</span></Label>
          <Rating name="table_score" required />
          <Label>대화는 잘 통했나요?</Label>
          <Rating name="convo_score" />
          <Label>식당은 어땠나요?</Label>
          <Rating name="venue_score" />
          <Label>우연한 식탁에 또 참여하고 싶나요?</Label>
          <Rating name="revisit_intent" />
          <Label>친구에게 추천하고 싶나요?</Label>
          <Rating name="recommend_intent" />
        </Card>

        {others.length > 0 && (
          <Card>
            <Label hint="상대방에게는 절대 공개되지 않아요">함께한 사람들</Label>
            <div className="space-y-3">
              {others.map((m) => (
                <div key={m.profile_id}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F9E7E3] text-xl">{mainAnimal(m.animals)?.emoji ?? "🙂"}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{m.nickname} <span className="font-normal text-[#6A4A4C]">· {m.age_band}{m.mbti ? ` · ${m.mbti}` : ""}</span></p>
                      <p className="truncate text-xs text-[#8B6A66]">{mainAnimal(m.animals)?.name}{(m.interests ?? []).length ? ` · ${(m.interests ?? []).slice(0, 2).join(", ")}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PEOPLE.map(([v, label]) => (
                      <label key={v} className="cursor-pointer">
                        <input type="radio" name={`p_${m.profile_id}`} value={v} defaultChecked={v === "NEUTRAL"} className="peer sr-only" />
                        <span className="inline-block rounded-full border border-[#E9DCD3] bg-[#FFFCF9] px-3 py-1.5 text-xs peer-checked:border-[#7A1F2B] peer-checked:bg-[#7A1F2B] peer-checked:text-white">
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-[#8B6A66]">
              &ldquo;또 만나고 싶어요&rdquo;는 다음 매칭에 반영하고, &ldquo;다시는 안 만날래요&rdquo;를 고르면 앞으로 같은 테이블에 배정하지 않아요.
            </p>
          </Card>
        )}

        <Card>
          <Label hint="선택">하고 싶은 말</Label>
          <textarea name="comment" rows={3} maxLength={500} placeholder="좋았던 점, 아쉬웠던 점을 자유롭게 남겨 주세요" className={inputCls} />

          {others.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-[#A2412A]">불편한 일이 있었나요? 신고하기</summary>
              <div className="mt-3 space-y-2">
                <select name="report_to" className={inputCls} defaultValue="">
                  <option value="">대상 선택</option>
                  {others.map((m) => <option key={m.profile_id} value={m.profile_id}>{mainAnimal(m.animals)?.emoji} {m.nickname} · {m.age_band}{m.mbti ? ` · ${m.mbti}` : ""}</option>)}
                </select>
                <textarea name="report_reason" rows={2} maxLength={500} placeholder="어떤 일이 있었는지 알려 주세요" className={inputCls} />
                <p className="text-xs text-[#8B6A66]">신고하면 즉시 서로 같은 테이블에 배정되지 않고, 운영자가 확인 후 조치해요.</p>
              </div>
            </details>
          )}
        </Card>

        <Submit>피드백 보내고 쿠폰 받기</Submit>
      </form>
      <div className="mt-3"><ButtonLink href={`/table/${id}`} tone="ghost">나중에 할게요</ButtonLink></div>
    </Page>
  );
}

function Rating({ name, required }: { name: string; required?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {SCORES.map(([v, emoji, word]) => (
        <label key={v} className="cursor-pointer">
          <input type="radio" name={name} value={v} required={required} className="peer sr-only scroll-mt-32" />
          <span className="flex flex-col items-center rounded-xl border border-[#E9DCD3] bg-[#FFFCF9] py-2 text-xs peer-checked:border-[#7A1F2B] peer-checked:bg-[#7A1F2B] peer-checked:text-white">
            <span className="text-xl">{emoji}</span>{word}
          </span>
        </label>
      ))}
    </div>
  );
}

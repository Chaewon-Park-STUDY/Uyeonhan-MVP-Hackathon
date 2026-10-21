import { Badge, ButtonLink, Card, Page, Steps } from "@/components/ui";
import { DiamondRule, WaxSeal } from "@/components/brand";
import { Invitation } from "@/components/invitation";
import { TableIllustration } from "@/components/table-illustration";
import { ProfileSummary } from "@/components/profile-summary";
import { MATCH_LABEL, PAYMENT_LABEL, REGION_LABEL, mainAnimal, fmtDate, fmtDeadline, won } from "@/lib/labels";
import { getMe } from "@/lib/supabase/server";

type SlotRow = { id: string; starts_at: string; region_code: string; apply_deadline: string };
type AppRow = {
  id: string;
  payment_status: string;
  match_status: string;
  assigned_slot_id: string | null;
  created_at: string;
  application_slots: { event_slots: SlotRow }[];
  match_resolutions: { choice: string | null; chosen_slot_id: string | null } | null;
  payments: { amount: number; status: string; refund_amount: number | null; method: string }[];
  passes: { type: string } | null;
  pass_id: string | null;
  table_members: { table_id: string; dining_tables: { explanation: { shared_interests?: string[] } | null; venues: { name: string } | null } | null } | null;
};
type Intro = { nickname: string; age_band: string; mbti: string | null; interests: string[]; is_me: boolean; animals?: string[] | null };

const RESOLVED_TEXT: Record<string, string> = {
  TRANSFERRED: "다른 회차로 옮겼어요. 새 회차 매칭을 기다려 주세요.",
  PASS_KEPT: "이용권을 보관했어요. 다음 신청 때 쓸 수 있어요.",
  MEMBERSHIP_EXTENDED: "멤버십 기간을 7일 연장했어요.",
  REFUNDED: "전액 환불을 완료했어요.",
};

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user, profile } = await getMe();

  if (!user) return <Landing slots={await openSlots(supabase)} />;
  if (!profile) {
    return (
      <Page>
        <section className="mt-4 rounded-[28px] border border-[#C9A227]/50 bg-white px-6 pb-7 pt-6 text-center shadow-[0_8px_30px_rgba(122,31,43,0.08)]">
          <span className="inline-block"><WaxSeal size={60} /></span>
          <p className="mt-3 font-serif text-sm tracking-widest text-[#7A1F2B]">초대를 수락해 주셔서 고마워요</p>
          <h1 className="mt-2 font-serif text-2xl font-extrabold text-[#7A1F2B]">이제 당신의 자리 카드를<br />만들어 볼까요?</h1>
          <TableIllustration className="mx-auto mt-4 w-48" />
          <DiamondRule className="mx-8 mt-4 text-[#C9A227]" />
          <ol className="mx-auto mt-4 max-w-[260px] space-y-1.5 text-left text-sm text-[#6A4A4C]">
            <li>① 기본 정보와 MBTI</li>
            <li>② 요즘 관심사</li>
            <li>③ 나와 닮은 동물 · 함께하고 싶은 동물</li>
            <li>④ 알레르기 · 덜 좋아하는 음식</li>
          </ol>
          <p className="mt-4 text-xs text-[#8B6A66]">3분이면 끝나요. 같은 테이블 사람들에게는 이름 첫 글자와 동물 카드 정도만 보여요.</p>
          <div className="mt-5"><ButtonLink href="/onboarding">자리 카드 만들기</ButtonLink></div>
        </section>
      </Page>
    );
  }

  const { data } = await supabase
    .from("applications")
    .select(`id, payment_status, match_status, assigned_slot_id, created_at, pass_id,
             application_slots(event_slots(id, starts_at, region_code, apply_deadline)),
             match_resolutions(choice, chosen_slot_id),
             payments(amount, status, refund_amount, method), passes(type),
             table_members(table_id, dining_tables(explanation, venues(name)))`)
    .eq("application_status", "SUBMITTED")
    .order("created_at", { ascending: false });
  const apps = (data ?? []) as unknown as AppRow[];

  const intros: Record<string, Intro[]> = {};
  const fbDone: Record<string, boolean> = {};
  await Promise.all(apps.map(async (a) => {
    const tid = a.table_members?.table_id;
    if (a.match_status === "CONFIRMED" && tid) {
      const [{ data: rows }, { data: st }] = await Promise.all([
        supabase.rpc("table_intro", { p_table_id: tid }),
        supabase.rpc("my_table_status", { p_table: tid }).maybeSingle<{ feedback_done: boolean }>(),
      ]);
      intros[a.id] = (rows ?? []) as Intro[];
      fbDone[a.id] = !!st?.feedback_done;
    }
  }));

  return (
    <Page>
      <p className="text-sm text-[#8B6A66]">{profile.name}님,</p>
      <h1 className="mb-5 text-2xl font-bold">나의 우연한 식탁</h1>

      <div className="mb-4"><ProfileSummary p={profile} editHref="/profile" /></div>

      {sp.done && <Flash>신청이 접수됐어요. 매칭 결과는 발표 시각에 자동으로 알려 드려요.</Flash>}
      {sp.resolved && <Flash>{RESOLVED_TEXT[sp.resolved] ?? "처리됐어요."}</Flash>}

      {apps.length === 0 ? (
        <Card>
          <TableIllustration className="mx-auto mb-3 w-40" guests={["🐻", "🦉", "🐱", "❔"]} />
          <p className="mb-4 text-center text-sm text-[#6A4A4C]">아직 신청한 식탁이 없어요.<br />빈자리 하나가 당신을 기다리고 있어요.</p>
          <ButtonLink href="/apply">참가 신청하기</ButtonLink>
        </Card>
      ) : (
        <div className="space-y-4">
          {apps.map((a) => (
            <AppCard key={a.id} a={a} intro={intros[a.id]} feedbackDone={fbDone[a.id]}
                     passReused={apps.some((b) => b.id !== a.id && b.pass_id === a.pass_id && b.created_at > a.created_at)} />
          ))}
          <ButtonLink href="/apply" tone="ghost">다른 회차 신청하기</ButtonLink>
        </div>
      )}
    </Page>
  );
}

function AppCard({ a, intro, passReused, feedbackDone }: { a: AppRow; intro?: Intro[]; passReused: boolean; feedbackDone?: boolean }) {
  const slots = a.application_slots.map((s) => s.event_slots).sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  const assigned = slots.find((s) => s.id === a.assigned_slot_id);
  const m = MATCH_LABEL[a.match_status] ?? { label: a.match_status, tone: "muted" as const };
  const step: 0 | 1 | 2 | 3 =
    a.match_status === "CONFIRMED" ? 3 : a.payment_status === "PAID" ? 2 : a.payment_status === "PENDING" ? 1 : 0;
  const announce = slots.length ? slots.reduce((min, s) => (s.apply_deadline < min ? s.apply_deadline : min), slots[0].apply_deadline) : null;
  const payment = a.payments[0];
  const shared = a.table_members?.dining_tables?.explanation?.shared_interests ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between">
        <Badge tone={m.tone}>{m.label}</Badge>
        <span className="text-xs text-[#8B6A66]">{payment?.method === "KEPT_PASS" && a.payment_status === "PAID" ? "보관 이용권 사용"
            : payment?.method === "MEMBERSHIP" && a.payment_status === "PAID" ? "멤버십"
            : PAYMENT_LABEL[a.payment_status] ?? a.payment_status}</span>
      </div>
      {["NO_MATCH", "EXCEPTION"].includes(a.match_status) ? null : <Steps current={step} />}

      {a.match_status === "CONFIRMED" && assigned ? (
        <div className="space-y-3">
          <p className="text-lg font-bold">{fmtDate(assigned.starts_at)}</p>
          <p className="text-sm">{REGION_LABEL[assigned.region_code]} · 나 포함 {intro?.length ?? 0}명이 함께해요</p>
          {shared.length > 0 && (
            <p className="rounded-xl bg-[#FBF1EC] px-3 py-2 text-sm">
              함께 나눌 이야기: <b>{shared.join(", ")}</b>
            </p>
          )}
          {intro && intro.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 text-xs">
              {intro.map((p, i) => (
                <li key={i} className={`rounded-xl border px-3 py-2 ${p.is_me ? "border-[#7A1F2B] bg-[#FBF1EC]" : "border-[#EFE3DC]"}`}>
                  <span className="mr-1">{mainAnimal(p.animals)?.emoji}</span><b>{p.is_me ? "나" : p.nickname}</b> · {p.age_band}{p.mbti ? ` · ${p.mbti}` : ""}
                  <p className="mt-0.5 truncate text-[#8B6A66]">{p.interests.slice(0, 2).join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
          {a.table_members?.dining_tables?.venues?.name && (
            <p className="text-sm">📍 {a.table_members.dining_tables.venues.name}</p>
          )}
          <ButtonLink href={`/table/${a.table_members?.table_id}`}>단체방 · 식당 안내 보기</ButtonLink>
          <p className="text-center text-xs text-[#8B6A66]">
            피드백 {feedbackDone ? "✅ 제출 완료" : "아직 안 남겼어요 (모임 후 단체방 화면에서)"}
          </p>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="text-[#8B6A66]">신청한 회차</p>
          {slots.map((s) => (
            <p key={s.id}>· {fmtDate(s.starts_at)} {REGION_LABEL[s.region_code]}</p>
          ))}
          {a.match_status === "ALTERNATIVE_OFFERED" && (
            <p className="mt-2 rounded-xl bg-[#FCEDE8] px-3 py-2 text-xs text-[#A2412A]">
              이 회차에서는 조건(나이 차이·인원 등)에 맞는 테이블을 만들지 못했어요. 결제는 그대로예요.
              다른 일정으로 옮기기 · 이용권 보관 · 전액 환불 중에서 골라 주세요.
            </p>
          )}
        </div>
      )}

      {a.match_status === "WAITING" && a.payment_status === "PAID" && announce && (
        <p className="mt-3 rounded-xl bg-[#F4E4DE] px-3 py-2 text-xs">
          {fmtDeadline(announce)}에 자동으로 매칭돼요. 조건에 맞는 4~6명을 찾고 있어요.
        </p>
      )}
      {a.match_resolutions?.choice === "MOVE_DATE" || a.match_resolutions?.choice === "MOVE_REGION" ? (
        <p className="mt-3 text-xs text-[#8B6A66]">지난 회차에서 매칭되지 않아 원하신 대로 이 회차로 옮겼어요.</p>
      ) : null}

      {a.payment_status === "PENDING" && (
        <div className="mt-4"><ButtonLink href={`/pay/${a.id}`}>결제하고 매칭 대기하기</ButtonLink></div>
      )}
      {a.match_status === "ALTERNATIVE_OFFERED" && (
        <div className="mt-4"><ButtonLink href={`/resolve/${a.id}`}>다른 일정 고르기</ButtonLink></div>
      )}
      {a.match_status === "NO_MATCH" && a.match_resolutions?.choice === "KEEP_PASS" && (
        <p className="mt-3 rounded-xl bg-[#F4E4DE] px-3 py-2 text-xs">
          이번엔 매칭되지 않아 <b>이용권을 보관했어요.</b>{" "}
          {a.passes?.type !== "SINGLE" ? "멤버십 기간이 7일 연장됐어요."
            : passReused ? "보관한 이용권은 다음 신청에 사용했어요." : "다음에 신청하면 결제 없이 바로 사용돼요."}
        </p>
      )}
      {a.payment_status === "REFUNDED" && payment?.refund_amount != null && (
        <p className="mt-3 text-xs text-[#8B6A66]">{won(payment.refund_amount)} 환불 완료</p>
      )}
    </Card>
  );
}

function Flash({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">{children}</p>;
}

async function openSlots(supabase: Awaited<ReturnType<typeof getMe>>["supabase"]) {
  const { data } = await supabase
    .from("event_slots")
    .select("id, starts_at, region_code, apply_deadline")
    .eq("is_open", true)
    .gt("apply_deadline", new Date().toISOString())
    .order("starts_at")
    .order("region_code");
  return (data ?? []) as SlotRow[];
}

function Landing({ slots }: { slots: SlotRow[] }) {
  const dates = [...new Set(slots.map((s) => s.starts_at))];
  const regions = [...new Set(slots.map((s) => REGION_LABEL[s.region_code]))];
  return (
    <>
      <Invitation nextDate={dates[0] ? fmtDate(dates[0]) : null}
                  regions={regions.length ? regions : ["홍대/합정", "강남/신논현", "을지로/종로", "잠실"]} />
      <Page>
        <h2 className="mb-3 mt-2 font-serif text-lg font-bold text-[#7A1F2B]">모집 중인 식탁</h2>
        <div className="space-y-2">
          {dates.length === 0 && <p className="text-sm text-[#8B6A66]">지금 모집 중인 회차가 없어요.</p>}
          {dates.map((d) => (
            <Card key={d} className="py-4">
              <p className="font-semibold">{fmtDate(d)}</p>
              <p className="mt-1 text-sm text-[#6A4A4C]">
                {slots.filter((s) => s.starts_at === d).map((s) => REGION_LABEL[s.region_code]).join(" · ")}
              </p>
            </Card>
          ))}
        </div>

        <h2 className="mb-3 mt-10 font-serif text-lg font-bold text-[#7A1F2B]">이렇게 진행돼요</h2>
        <ol className="space-y-3 text-sm text-[#6A4A4C]">
          {[
            ["초대 수락", "프로필과 나를 닮은 동물 카드를 만들고, 가능한 날짜·지역을 골라 신청해요."],
            ["좌석 배치", "화요일 밤, 나이·성비·MBTI·관심사와 동물 카드를 고려해 4~6명 테이블이 자동으로 만들어져요."],
            ["저녁 식탁", "식당과 단체방이 열리고, 목요일 저녁에 만나요."],
            ["다음 초대", "식사 후 남긴 피드백이 다음 매칭을 더 정교하게 만들어요."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#C9A227] font-serif text-sm text-[#7A1F2B]">{i + 1}</span>
              <span><b className="text-[#2E1B1E]">{t}</b><br />{d}</span>
            </li>
          ))}
        </ol>
      </Page>
    </>
  );
}

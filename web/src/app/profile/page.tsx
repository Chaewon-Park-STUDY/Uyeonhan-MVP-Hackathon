import { redirect } from "next/navigation";
import { ButtonLink, Card, Page } from "@/components/ui";
import { FAIL_PREFS, PASSES, REGION_LABEL, animalOf, byRarity, fmtDate } from "@/lib/labels";

const ATTEND_LABEL: Record<string, string> = { SCHEDULED: "예정", ATTENDED: "참석", NO_SHOW: "노쇼", CANCELED_EARLY: "사전 취소", CANCELED_LATE: "당일 취소" };

// 1회권: 신청에 쓰였으면 "○월 ○일 모임에 사용", 보관 중이면 "남은 1회"
type PassRow = { id: string; type: string; remaining: number | null; expires_at: string | null; created_at: string;
  applications: { application_status: string; match_status: string; payment_status: string; application_slots: { event_slots: { starts_at: string } | null }[] }[] };
function singleState(x: PassRow) {
  const used = x.applications.find((a) => a.application_status === "SUBMITTED" && !["NO_MATCH"].includes(a.match_status)
    && !a.payment_status.startsWith("REFUND"));
  if (!used) {
    // 결제까지 끝났는데 매칭이 안 된(보관) 1회권만 다음 신청에 재사용됨 — 결제 전 취소한 건은 표시하지 않음
    const kept = x.applications.some((a) => a.match_status === "NO_MATCH" && a.payment_status === "PAID");
    return kept ? `남은 ${x.remaining}회 · 다음 신청에 바로 사용` : null;
  }
  const first = used.application_slots.map((s) => s.event_slots?.starts_at).filter(Boolean).sort()[0];
  return first ? `${fmtDate(first).split(" ").slice(0, 3).join(" ")} 모임에 사용 중` : "신청에 사용 중";
}

const COUPON_LABEL: Record<string, string> = { REVISIT: "재방문", REFERRAL_NEW: "친구 초대", REFERRAL_INVITER: "친구 초대", LAST_MINUTE: "마감 할인", NO_SHOW_COMPENSATION: "보상" };
import { AnimalBadge } from "@/components/animal-cards";
import { ProfileSummary } from "@/components/profile-summary";
import { getMe } from "@/lib/supabase/server";
import { PendingButton } from "@/components/pending";
import { deleteAccount, enterReferral } from "./actions";
import { CopyButton } from "@/components/copy-button";
import { inputCls } from "@/components/ui";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; ref_ok?: string }> }) {
  const { saved, error, ref_ok } = await searchParams;
  const { supabase, user, profile: p } = await getMe();
  if (!user) redirect("/login?next=/profile");
  if (!p) redirect("/onboarding");

  const nowIso = new Date().toISOString();
  const [{ data: passes }, { data: coupons }, { data: mine }, { data: fbs }, { data: refRows }] = await Promise.all([
    supabase.from("passes").select("id, type, remaining, expires_at, created_at, applications(application_status, match_status, payment_status, application_slots(event_slots(starts_at)))").order("created_at", { ascending: false }).limit(5),
    supabase.from("coupons").select("kind, discount_rate, expires_at").is("used_at", null).gt("expires_at", nowIso),
    // 참가 이력 (RET-01): 내가 들어갔던 확정 테이블
    supabase.from("table_members").select("table_id, attendance, dining_tables(status, event_slots(starts_at, region_code))")
      .eq("user_id", p.id),
    supabase.from("feedback").select("table_id").eq("user_id", p.id),
    supabase.rpc("my_referral"),
  ]);
  const ref = ((refRows ?? []) as { code: string; invited: number; rewarded: number; referred: boolean; can_enter: boolean }[])[0];
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://uyeonhan-mvp-hackathon.vercel.app";
  const inviteLink = ref ? `${site}/login?mode=signup&ref=${ref.code}` : "";
  type Hist = { table_id: string; attendance: string; dining_tables: { status: string; event_slots: { starts_at: string; region_code: string } | null } | null };
  const fbDone = new Set((fbs ?? []).map((f) => f.table_id));
  const history = ((mine ?? []) as unknown as Hist[])
    .filter((h) => h.dining_tables?.status === "CONFIRMED" && h.dining_tables.event_slots)
    .sort((a, b) => b.dining_tables!.event_slots!.starts_at.localeCompare(a.dining_tables!.event_slots!.starts_at));
  const clean = (xs: string[] | null) => (xs ?? []).map((x) => x.replace(/^기타:/, ""));
  const failPref = FAIL_PREFS.find((f) => f.value === p.default_fail_pref)?.label;

  return (
    <Page title="내 프로필" back="/">
      {error && <p className="mb-4 rounded-xl bg-[#FCEDE8] px-4 py-3 text-sm text-[#A2412A]">{error}</p>}
      {ref_ok && <p className="mb-4 rounded-xl bg-[#FBEFD0] px-4 py-3 text-sm text-[#8A5B00]">🎁 초대 코드가 확인됐어요. 친구 초대 할인 쿠폰을 드렸어요.</p>}
      {saved && <p className="mb-4 rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">저장했어요.</p>}

      <ProfileSummary p={p} />

      <Card className="mt-4 space-y-4">
        <div>
          <p className="mb-1.5 text-xs text-[#8B6A66]">나와 닮은 동물</p>
          <div className="flex flex-wrap gap-1.5">{byRarity(p.self_traits).map((v: string) => <AnimalBadge key={v} card={animalOf(v)} />)}</div>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-[#8B6A66]">함께하고 싶은 동물</p>
          <div className="flex flex-wrap gap-1.5">{(p.desired_traits ?? []).map((v: string) => <AnimalBadge key={v} card={animalOf(v)} />)}</div>
        </div>
      </Card>

      <Card className="mt-4">
        <p className="mb-2 text-xs text-[#8B6A66]">내 이용권 · 쿠폰</p>
        {(passes ?? []).length === 0 && (coupons ?? []).length === 0 && <p className="text-sm">아직 없어요.</p>}
        <ul className="space-y-1.5 text-sm">
          {(() => {
            // 같은 종류·같은 상태는 한 줄로 묶기 (예: 1회권 2장 · 10월 29일 모임에 사용 중)
            const rows = new Map<string, { label: string; state: string; n: number }>();
            for (const x of (passes ?? []) as unknown as PassRow[]) {
              if (x.type !== "SINGLE" ? !(x.expires_at && x.expires_at > nowIso) : !((x.remaining ?? 0) > 0)) continue;
              const label = PASSES.find((q) => q.value === x.type)?.label ?? x.type;
              const state = x.type === "SINGLE" ? singleState(x) : `${fmtDate(x.expires_at!).split(" ").slice(0, 3).join(" ")}까지`;
              if (!state) continue;
              const k = label + state;
              rows.set(k, { label, state, n: (rows.get(k)?.n ?? 0) + 1 });
            }
            return [...rows.values()].map((r, i) => (
              <li key={i} className="flex justify-between">
                <span>🎟️ {r.label}{r.n > 1 ? ` ${r.n}장` : ""}</span>
                <span className="text-[#6A4A4C]">{r.state}</span>
              </li>
            ));
          })()}
          {(coupons ?? []).map((c, i) => (
            <li key={`c${i}`} className="flex justify-between">
              <span>🏷️ {COUPON_LABEL[c.kind] ?? "할인"} 쿠폰 {Math.round(c.discount_rate * 100)}%</span>
              <span className="text-[#6A4A4C]">{fmtDate(c.expires_at).split(" ").slice(0, 3).join(" ")}까지</span>
            </li>
          ))}
        </ul>
      </Card>

      {ref && (
        <Card className="mt-4">
          <p className="mb-1 text-xs text-[#8B6A66]">친구 초대</p>
          <p className="text-sm text-[#6A4A4C]">친구가 내 코드로 가입하면 친구는 첫 신청 할인, 친구가 결제하면 나도 할인 쿠폰을 받아요.</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="flex-1 rounded-xl border border-dashed border-[#C9A227] bg-[#FFFCF9] px-4 py-2.5 text-center font-mono text-lg font-bold tracking-widest text-[#7A1F2B]">{ref.code}</span>
            <CopyButton text={ref.code} label="코드 복사" />
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#8B6A66]">
            <span className="min-w-0 flex-1 truncate">{inviteLink}</span>
            <CopyButton text={inviteLink} label="초대 링크 보내기" shareTitle="우연한 식탁에 초대해요" />
          </div>
          <p className="mt-2 text-xs text-[#6A4A4C]">지금까지 <b>{ref.invited}명</b>이 내 코드로 가입했고, 감사 쿠폰 <b>{ref.rewarded}장</b>을 받았어요.</p>
          {ref.can_enter && (
            <form action={enterReferral} className="mt-3 flex gap-2 border-t border-[#F4ECE6] pt-3">
              <input name="code" placeholder="친구에게 받은 초대 코드" autoComplete="off" className={`${inputCls} py-2 text-sm`} />
              <button className="shrink-0 rounded-xl bg-[#7A1F2B] px-3 text-sm font-semibold text-white">넣기</button>
            </form>
          )}
        </Card>
      )}

      <Card className="mt-4">
        <p className="mb-2 text-xs text-[#8B6A66]">참가 이력</p>
        {history.length === 0 ? <p className="text-sm">아직 참가한 모임이 없어요.</p> : (
          <ul className="space-y-2 text-sm">
            {history.map((h) => {
              const s = h.dining_tables!.event_slots!;
              const past = s.starts_at < nowIso;
              const att = h.attendance === "SCHEDULED" ? (past ? "참석 확인 중" : "예정") : ATTEND_LABEL[h.attendance] ?? h.attendance;
              return (
                <li key={h.table_id} className="flex flex-wrap items-center justify-between gap-1">
                  <a href={`/table/${h.table_id}`} className="underline-offset-2 hover:underline">
                    🍽️ {fmtDate(s.starts_at).split(" ").slice(0, 3).join(" ")} · {REGION_LABEL[s.region_code]}
                  </a>
                  <span className="flex gap-1 text-xs">
                    <span className="rounded-full bg-[#F4E4DE] px-2 py-0.5">{att}</span>
                    <span className={`rounded-full px-2 py-0.5 ${fbDone.has(h.table_id) ? "bg-[#E3F1E4] text-[#2F6B3A]" : "bg-[#F4ECE6] text-[#8B6A66]"}`}>
                      피드백 {fbDone.has(h.table_id) ? "제출" : "미제출"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-4 space-y-4">
        <Row title="알레르기" items={clean(p.allergies)} empty="없음" />
        <Row title="피하고 싶은 음식" items={clean(p.food_dislikes)} empty="없음" />
        <Row title="식사 예산" items={p.budget_ranges} empty="상관 없음" />
        <div>
          <p className="mb-1 text-xs text-[#8B6A66]">매칭이 안 되면 (기본값)</p>
          <p className="text-sm">{failPref}</p>
        </div>
      </Card>

      <Card className="mt-4 text-xs text-[#8B6A66]">
        <p>같은 테이블 참가자에게는 <b>이름 첫 글자, 연령대, MBTI, 관심사, 나와 닮은 동물</b>만 보여요.</p>
        <p className="mt-1">연락처·출생연도·직업·음식 정보는 매칭과 식당 선정에만 쓰여요.</p>
      </Card>

      <div className="mt-5">
        <ButtonLink href="/onboarding">프로필 수정하기</ButtonLink>
      </div>

      <details className="mt-8 text-xs text-[#8B6A66]">
        <summary className="cursor-pointer text-center">회원 탈퇴</summary>
        <form action={deleteAccount} className="mt-3 space-y-2 rounded-xl border border-[#E9DCD3] bg-white p-4">
          <p>탈퇴하면 이름·연락처·직업·식사 정보와 로그인 계정이 바로 삭제돼요.</p>
          <p>참석·피드백 기록은 이름 없이 통계로만 남고, 결제 기록은 법에 따라 5년간 보관돼요.</p>
          <p>확정된 모임이 남아 있거나 결제한 신청이 매칭을 기다리는 중이면 먼저 정리해야 해요.</p>
          <label className="flex items-center gap-2 text-[#2E1B1E]"><input type="checkbox" name="confirm" className="accent-[#7A1F2B]" /> 위 내용을 확인했어요</label>
          <PendingButton className="w-full rounded-lg border border-[#A2412A] py-2 text-[#A2412A]" pendingText="처리 중…">탈퇴하기</PendingButton>
        </form>
      </details>
    </Page>
  );
}

function Row({ title, items, empty = "-" }: { title: string; items: string[] | null; empty?: string }) {
  const xs = items ?? [];
  return (
    <div>
      <p className="mb-1.5 text-xs text-[#8B6A66]">{title}</p>
      {xs.length === 0 ? (
        <p className="text-sm">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {xs.map((x) => <span key={x} className="rounded-full border border-[#E9DCD3] px-2.5 py-1 text-xs">{x}</span>)}
        </div>
      )}
    </div>
  );
}

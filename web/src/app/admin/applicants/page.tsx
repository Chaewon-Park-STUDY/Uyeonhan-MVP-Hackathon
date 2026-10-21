import { AdminTitle, FilterChips, Pill, TableWrap, kstDate, shortDt, td, th } from "@/components/admin-ui";
import { requireAdmin } from "@/lib/admin";
import { MATCH_LABEL, PAYMENT_LABEL, REGION_LABEL, animalOf, byRarity } from "@/lib/labels";

type App = {
  id: string; submitted_at: string | null; payment_status: string; match_status: string; application_status: string;
  profiles: { id: string; name: string; birth_year: number; gender: string; mbti: string | null; interests: string[]; self_traits: string[];
    restricted_until: string | null; phone: string | null; job: string | null };
  application_slots: { event_slots: { starts_at: string; region_code: string } | null }[];
};

// PRD §11 신청자 목록: 프로필, 희망 일정, 결제 상태, 이전 참석·신고 이력 조회 및 필터
export default async function Applicants({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();

  const { data } = await supabase.from("applications")
    .select("id, submitted_at, payment_status, match_status, application_status, profiles(id, name, birth_year, gender, mbti, interests, self_traits, restricted_until, phone, job), application_slots(event_slots(starts_at, region_code))")
    .neq("application_status", "DRAFT").order("submitted_at", { ascending: false }).limit(500);
  let apps = (data ?? []) as unknown as App[];

  const dates = [...new Set(apps.flatMap((a) => a.application_slots.map((s) => s.event_slots && kstDate(s.event_slots.starts_at))).filter(Boolean) as string[])].sort();
  if (sp.date) apps = apps.filter((a) => a.application_slots.some((s) => s.event_slots && kstDate(s.event_slots.starts_at) === sp.date));
  if (sp.pay) apps = apps.filter((a) => a.payment_status === sp.pay);
  if (sp.match) apps = apps.filter((a) => a.match_status === sp.match);
  if (sp.q) apps = apps.filter((a) => a.profiles.name.includes(sp.q!));

  // 이전 참석·신고 이력
  const [{ data: att }, { data: reps }] = await Promise.all([
    supabase.from("table_members").select("user_id, attendance").limit(5000),
    supabase.from("safety_reports").select("reported_id").limit(5000),
  ]);
  const hist = new Map<string, { attended: number; noshow: number; reported: number }>();
  for (const r of att ?? []) {
    const h = hist.get(r.user_id) ?? { attended: 0, noshow: 0, reported: 0 };
    if (r.attendance === "ATTENDED") h.attended++;
    if (r.attendance === "NO_SHOW" || r.attendance === "CANCELED_LATE") h.noshow++;
    hist.set(r.user_id, h);
  }
  for (const r of reps ?? []) {
    const h = hist.get(r.reported_id) ?? { attended: 0, noshow: 0, reported: 0 };
    h.reported++;
    hist.set(r.reported_id, h);
  }
  const year = new Date().getFullYear();
  const keep = { date: sp.date, pay: sp.pay, match: sp.match, q: sp.q };
  const payTone = (s: string) => (s === "PAID" ? "ok" : s === "PENDING" ? "wait" : s.startsWith("REFUND") ? "info" : "warn");

  return (
    <div className="space-y-3">
      <AdminTitle title="신청자" desc={`조건에 맞는 신청 ${apps.length}건 · 이름을 눌러 검색하거나 아래 칩으로 걸러 보세요.`}>
        <a href="/admin/export?type=applicants" className="ml-auto rounded-full border border-[#E9DCD3] bg-white px-3 py-1 text-sm">⬇ CSV 내보내기</a>
        <form className="flex gap-1.5">
          {sp.date && <input type="hidden" name="date" value={sp.date} />}
          <input name="q" defaultValue={sp.q} placeholder="이름 검색" className="rounded-full border border-[#E9DCD3] bg-white px-3 py-1 text-sm" />
          <button className="rounded-full bg-[#7A1F2B] px-3 py-1 text-sm text-white">검색</button>
        </form>
      </AdminTitle>
      <FilterChips base="/admin/applicants" param="date" current={sp.date} keep={keep}
                   options={[["", "모든 날짜"], ...dates.map((d) => [d, d] as [string, string])]} />
      <FilterChips base="/admin/applicants" param="pay" current={sp.pay} keep={keep}
                   options={[["", "결제 전체"], ["PENDING", "결제 대기"], ["PAID", "결제 완료"], ["REFUNDED", "환불 완료"], ["REFUND_FAILED", "환불 실패"]]} />
      <FilterChips base="/admin/applicants" param="match" current={sp.match} keep={keep}
                   options={[["", "매칭 전체"], ["WAITING", "매칭 대기"], ["CONFIRMED", "확정"], ["ALTERNATIVE_OFFERED", "다른 일정 선택 필요"], ["NO_MATCH", "매칭 종료"]]} />

      <TableWrap min={980}>
        <thead>
          <tr><th className={th}>이름</th><th className={th}>프로필</th><th className={th}>희망 일정</th><th className={th}>결제</th>
            <th className={th}>매칭</th><th className={th}>이전 이력</th><th className={th}>신청 시각</th></tr>
        </thead>
        <tbody>
          {apps.slice(0, 200).map((a) => {
            const p = a.profiles;
            const h = hist.get(p.id) ?? { attended: 0, noshow: 0, reported: 0 };
            const restricted = p.restricted_until && p.restricted_until > new Date().toISOString();
            return (
              <tr key={a.id}>
                <td className={td}>
                  <span className="mr-1">{animalOf(byRarity(p.self_traits)[0])?.emoji}</span><b>{p.name}</b>
                  {restricted && <div className="mt-0.5"><Pill tone="warn">참가 제한 중</Pill></div>}
                </td>
                <td className={`${td} text-xs text-[#6A4A4C]`}>
                  {year - p.birth_year}세 · {p.gender === "F" ? "여" : "남"} · {p.mbti ?? "-"}{p.job ? ` · ${p.job}` : ""}
                  <div className="text-[#8B6A66]">{p.interests.slice(0, 3).join(", ")}</div>
                </td>
                <td className={`${td} text-xs`}>
                  {a.application_slots.filter((s) => s.event_slots).map((s, i) => (
                    <div key={i}>{kstDate(s.event_slots!.starts_at).slice(5)} {REGION_LABEL[s.event_slots!.region_code]}</div>
                  ))}
                </td>
                <td className={td}><Pill tone={payTone(a.payment_status)}>{PAYMENT_LABEL[a.payment_status] ?? a.payment_status}</Pill></td>
                <td className={td}><Pill tone={MATCH_LABEL[a.match_status]?.tone === "ok" ? "ok" : MATCH_LABEL[a.match_status]?.tone === "warn" ? "warn" : "muted"}>
                  {MATCH_LABEL[a.match_status]?.label ?? a.match_status}</Pill></td>
                <td className={`${td} text-xs`}>
                  참석 {h.attended}회
                  {h.noshow > 0 && <span className="ml-1 text-[#A2412A]">· 노쇼/당일취소 {h.noshow}</span>}
                  {h.reported > 0 && <span className="ml-1 text-[#A2412A]">· 신고됨 {h.reported}</span>}
                </td>
                <td className={`${td} text-xs text-[#8B6A66]`}>{shortDt(a.submitted_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      {apps.length > 200 && <p className="text-xs text-[#8B6A66]">앞의 200건만 보여요. 날짜·상태로 좁혀 보세요.</p>}
    </div>
  );
}

import { GenderTag } from "@/components/admin-ui";
import { AdminTitle, FilterChips, FilterRow, Pager, Pill, TableWrap, kstDate, shortDt, td, th, todayKst } from "@/components/admin-ui";
import { requireAdmin } from "@/lib/admin";
import { REGION_COLOR } from "../region-map";
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
  // 처음 열면 다가오는 모임일로 (전체는 "모든 날짜")
  const date = sp.date ?? dates.find((d) => d >= todayKst()) ?? "";
  if (date && date !== "all") apps = apps.filter((a) => a.application_slots.some((s) => s.event_slots && kstDate(s.event_slots.starts_at) === date));
  if (sp.region) apps = apps.filter((a) => a.application_slots.some((s) => s.event_slots?.region_code === sp.region &&
    (!date || date === "all" || kstDate(s.event_slots!.starts_at) === date)));
  if (sp.gender) apps = apps.filter((a) => a.profiles.gender === sp.gender);
  if (sp.pay) apps = apps.filter((a) => a.payment_status === sp.pay);
  if (sp.match) apps = apps.filter((a) => a.match_status === sp.match);
  if (sp.q) apps = apps.filter((a) => a.profiles.name.includes(sp.q!));

  // 이전 참석·신고 이력
  const [{ data: att }, { data: reps }] = await Promise.all([
    supabase.from("table_members").select("user_id, attendance").limit(5000),
    supabase.from("safety_reports").select("reported_id").limit(5000),
  ]);
  const hist = new Map<string, { attended: number; noshow: number; late: number; reported: number }>();
  for (const r of att ?? []) {
    const h = hist.get(r.user_id) ?? { attended: 0, noshow: 0, late: 0, reported: 0 };
    if (r.attendance === "ATTENDED") h.attended++;
    if (r.attendance === "NO_SHOW") h.noshow++;
    if (r.attendance === "CANCELED_LATE") h.late++;
    hist.set(r.user_id, h);
  }
  for (const r of reps ?? []) {
    const h = hist.get(r.reported_id) ?? { attended: 0, noshow: 0, late: 0, reported: 0 };
    h.reported++;
    hist.set(r.reported_id, h);
  }
  const year = new Date().getFullYear();
  const keep = { date, region: sp.region, gender: sp.gender, pay: sp.pay, match: sp.match, q: sp.q };
  const page = Math.max(1, Number(sp.page) || 1);
  const shown = apps.slice((page - 1) * 20, page * 20);
  const csvHref = `/admin/export?${new URLSearchParams(Object.entries({ type: "applicants", ...keep }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const payTone = (s: string) => (s === "PAID" ? "ok" : s === "PENDING" ? "wait" : s.startsWith("REFUND") ? "info" : "warn");

  return (
    <div className="space-y-3">
      <AdminTitle title="신청자" desc={`조건에 맞는 신청 ${apps.length}건 · 한 쪽에 20명씩 보여요.`}>
        <form className="ml-auto flex gap-1.5">
          {Object.entries(keep).filter(([k, v]) => v && k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="q" defaultValue={sp.q} placeholder="이름으로 찾기" className="rounded-full border border-[#E9DCD3] bg-white px-3 py-1 text-sm" />
          <button className="rounded-full bg-[#7A1F2B] px-3 py-1 text-sm text-white">찾기</button>
        </form>
      </AdminTitle>

      <div className="grid gap-x-6 gap-y-2 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(74,52,38,0.08)] lg:grid-cols-2">
        <FilterRow label="모임일">
          <FilterChips base="/admin/applicants" param="date" current={date} keep={keep}
                       options={[["all", "모든 날짜"], ...dates.map((d) => [d, d.slice(5).replace("-", "/")] as [string, string])]} />
        </FilterRow>
        <FilterRow label="지역">
          <FilterChips base="/admin/applicants" param="region" current={sp.region} keep={keep}
                       options={[["", "전체"], ...Object.entries(REGION_LABEL)]} />
        </FilterRow>
        <FilterRow label="성별">
          <FilterChips base="/admin/applicants" param="gender" current={sp.gender} keep={keep} options={[["", "전체"], ["F", "여"], ["M", "남"]]} />
        </FilterRow>
        <FilterRow label="결제">
          <FilterChips base="/admin/applicants" param="pay" current={sp.pay} keep={keep}
                       options={[["", "전체"], ["PENDING", "결제 대기"], ["PAID", "결제 완료"], ["REFUND_AVAILABLE", "환불 가능"], ["REFUNDED", "환불 완료"]]} />
        </FilterRow>
        <FilterRow label="매칭">
          <FilterChips base="/admin/applicants" param="match" current={sp.match} keep={keep}
                       options={[["", "전체"], ["WAITING", "매칭 대기"], ["CONFIRMED", "확정"], ["ALTERNATIVE_OFFERED", "다른 일정 선택 필요"], ["NO_MATCH", "매칭 종료"]]} />
        </FilterRow>
        <div className="flex flex-wrap items-center gap-3 border-t border-[#F4ECE6] pt-3 lg:col-span-2">
          <span className="flex flex-wrap gap-2 text-xs">
            {Object.entries(REGION_LABEL).map(([c, l]) => <span key={c} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: REGION_COLOR[c]?.main }} />{l}</span>)}
          </span>
          <a href={csvHref} className="ml-auto rounded-full bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white">⬇ 지금 보이는 {apps.length}명 엑셀(CSV)로 받기</a>
          <span className="text-xs text-[#8B6A66]">
            고른 조건 그대로 이름·연락처·나이·성별·직업·MBTI·관심사·희망 회차·상태가 담긴 엑셀 파일이에요. 연락처가 있으니 외부 공유 금지.
          </span>
        </div>
      </div>

      <TableWrap min={860}>
        <thead>
          <tr><th className={th}>이름</th><th className={th}>MBTI · 직업</th><th className={th}>희망 일정 <span className="font-normal">(점 색 = 지역)</span></th><th className={th}>결제</th>
            <th className={th}>매칭</th><th className={th}>이전 이력</th><th className={th}>신청 시각</th></tr>
        </thead>
        <tbody>
          {shown.map((a) => {
            const p = a.profiles;
            const h = hist.get(p.id) ?? { attended: 0, noshow: 0, late: 0, reported: 0 };
            const restricted = p.restricted_until && p.restricted_until > new Date().toISOString();
            // 희망 일정: 날짜별로 지역 색 점만 한 줄에 (예: 10/22 ●●●)
            const byDay = new Map<string, string[]>();
            for (const x of a.application_slots) {
              if (!x.event_slots) continue;
              const d = kstDate(x.event_slots.starts_at).slice(5).replace("-", "/");
              byDay.set(d, [...(byDay.get(d) ?? []), x.event_slots.region_code]);
            }
            return (
              <tr key={a.id} className="hover:bg-[#FBF7F0]">
                <td className={`${td} whitespace-nowrap`} title={p.interests.join(", ")}>
                  <span className="mr-1">{animalOf(byRarity(p.self_traits)[0])?.emoji}</span><b>{p.name}</b>
                  <GenderTag gender={p.gender} birthYear={p.birth_year} />
                  {restricted && <span className="ml-1"><Pill tone="warn">제한 중</Pill></span>}
                </td>
                <td className={`${td} whitespace-nowrap text-xs text-[#6A4A4C]`}>{p.mbti ?? "-"}{p.job ? ` · ${p.job}` : ""}</td>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {[...byDay.entries()].map(([d, regions]) => (
                    <span key={d} className="mr-2 inline-flex items-center gap-0.5" title={regions.map((c) => REGION_LABEL[c]).join(", ")}>
                      <span className="mr-0.5 text-[#6A4A4C]">{d}</span>
                      {regions.map((c) => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: REGION_COLOR[c]?.main }} />)}
                    </span>
                  ))}
                </td>
                <td className={td}><Pill tone={payTone(a.payment_status)}>{PAYMENT_LABEL[a.payment_status] ?? a.payment_status}</Pill></td>
                <td className={td}><Pill tone={a.application_status === "CANCELED" ? "muted" : MATCH_LABEL[a.match_status]?.tone === "ok" ? "ok" : MATCH_LABEL[a.match_status]?.tone === "warn" ? "warn" : "muted"}>
                  {a.application_status === "CANCELED" ? "신청 취소" : MATCH_LABEL[a.match_status]?.label ?? a.match_status}</Pill></td>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {h.attended ? `참석 ${h.attended}회` : "첫 참여"}
                  {h.noshow > 0 && <span className="ml-1 text-[#A2412A]">· 노쇼 {h.noshow}</span>}
                  {h.late > 0 && <span className="ml-1 text-[#A2412A]">· 당일 취소 {h.late}</span>}
                  {h.reported > 0 && <span className="ml-1 text-[#A2412A]">· 신고됨 {h.reported}</span>}
                </td>
                <td className={`${td} whitespace-nowrap text-xs text-[#8B6A66]`}>{shortDt(a.submitted_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <Pager base="/admin/applicants" page={page} total={apps.length} keep={keep} />
    </div>
  );
}

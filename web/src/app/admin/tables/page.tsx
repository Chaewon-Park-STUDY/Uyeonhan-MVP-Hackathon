import Link from "next/link";
import { Card } from "@/components/ui";
import { FEATURE_LABEL, requireAdmin } from "@/lib/admin";
import { REGION_LABEL, animalOf, byRarity } from "@/lib/labels";

type T = {
  id: string; status: string; score: number | null; score_breakdown: Record<string, number> | null;
  explanation: { shared_interests?: string[] } | null;
  event_slots: { starts_at: string; region_code: string }; venues: { name: string } | null;
  table_members: { attendance: string; reallocation_count: number;
    profiles: { name: string; birth_year: number; gender: string; mbti: string | null; self_traits: string[] | null } }[];
};

const ATT: Record<string, string> = { SCHEDULED: "예정", ATTENDED: "참석", CANCELED_EARLY: "사전취소", CANCELED_LATE: "당일취소", NO_SHOW: "노쇼" };

// 확정 테이블 + 매칭 근거 (PRD ADM-03, MAT-12: 운영자에게는 점수 구성까지 보여줌)
export default async function Tables({ searchParams }: { searchParams: Promise<{ date?: string; table?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: slots } = await supabase.from("event_slots").select("id, starts_at").order("starts_at");
  const allDates = [...new Set((slots ?? []).map((s) => new Date(new Date(s.starts_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10)))];
  const date = sp.date ?? allDates.find((d) => d >= new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) ?? allDates[0];
  const slotIds = (slots ?? []).filter((s) => new Date(new Date(s.starts_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) === date).map((s) => s.id);

  let q = supabase.from("dining_tables")
    .select("id, status, score, score_breakdown, explanation, event_slots(starts_at, region_code), venues(name), table_members(attendance, reallocation_count, profiles(name, birth_year, gender, mbti, self_traits))");
  q = sp.table ? q.eq("id", sp.table) : q.in("slot_id", slotIds.length ? slotIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q.order("created_at");
  const tables = (data ?? []) as unknown as T[];
  const year = new Date().getFullYear();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">테이블</h1>
        {allDates.map((d) => (
          <Link key={d} href={`/admin/tables?date=${d}`}
                className={`rounded-full px-3 py-1 text-sm ${d === date && !sp.table ? "bg-[#7A1F2B] text-white" : "border border-[#E9DCD3] bg-white"}`}>{d}</Link>
        ))}
      </div>
      {tables.length === 0 && <Card><p className="text-sm text-[#8B6A66]">이 날짜에는 아직 만들어진 테이블이 없어요. 매칭은 화요일 24:00 이후 자동 실행돼요.</p></Card>}
      <p className="text-sm text-[#8B6A66]">테이블을 누르면 멤버와 이 테이블을 만든 이유가 펼쳐져요.</p>
      <div className="space-y-2.5">
        {tables.map((t, i) => {
          const ages = t.table_members.map((m) => year - m.profiles.birth_year);
          const f = t.table_members.filter((m) => m.profiles.gender === "F").length;
          const issues = t.table_members.filter((m) => ["NO_SHOW", "CANCELED_LATE", "CANCELED_EARLY"].includes(m.attendance)).length;
          const score = t.score ?? 0;
          const grade = score >= 4.3 ? ["아주 잘 맞음", "bg-[#E3F1E4] text-[#2F6B3A]"] : score >= 4.0 ? ["잘 맞음", "bg-[#F4E4DE] text-[#7A1F2B]"] : ["보통", "bg-[#EEE9E4] text-[#8A7F77]"];
          return (
            <details key={t.id} open={!!sp.table} className="group rounded-2xl bg-white shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span className="text-base font-bold">#{i + 1} {REGION_LABEL[t.event_slots.region_code]}</span>
                <span className="text-xl tracking-tight">{t.table_members.map((m) => animalOf(byRarity(m.profiles.self_traits)[0])?.emoji ?? "🙂").join("")}</span>
                <span className="text-sm text-[#6A4A4C]">{t.table_members.length}명 · 여 {f} 남 {t.table_members.length - f} · {Math.min(...ages)}~{Math.max(...ages)}세</span>
                <span className="text-sm text-[#6A4A4C]">📍 {t.venues?.name?.replace(/^\[샘플\]\s*/, "") ?? "식당 미배정"}</span>
                <span className={`ml-auto rounded-full px-3 py-1 text-sm font-semibold ${grade[1]}`}>{grade[0]} · {score.toFixed(1)}점</span>
                {issues > 0 && <span className="rounded-full bg-[#FCEDE8] px-3 py-1 text-sm text-[#A2412A]">취소·노쇼 {issues}</span>}
                <span className="text-[#B7A3A0] transition group-open:rotate-180">▾</span>
              </summary>
              <div className="grid gap-5 border-t border-[#EFE3DC] px-5 py-4 md:grid-cols-2">
                <ul className="space-y-2 text-sm">
                  {t.table_members.map((m, j) => (
                    <li key={j} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="mr-1.5 text-lg">{animalOf(byRarity(m.profiles.self_traits)[0])?.emoji}</span>
                        <b>{m.profiles.name}</b> · {year - m.profiles.birth_year}세 · {m.profiles.gender === "F" ? "여" : "남"} · {m.profiles.mbti ?? "-"}
                        {m.reallocation_count > 0 && <span className="ml-1 text-xs text-[#8B6A66]">(다른 지역에서 이동)</span>}
                      </span>
                      <span className={m.attendance === "NO_SHOW" || m.attendance === "CANCELED_LATE" ? "text-[#A2412A]" : "text-[#8B6A66]"}>{ATT[m.attendance] ?? m.attendance}</span>
                    </li>
                  ))}
                </ul>
                <div className="text-sm">
                  <p className="mb-2 font-semibold">이 테이블을 만든 이유 <span className="font-normal text-[#8B6A66]">(각 100점 만점)</span></p>
                  <div className="space-y-1.5">
                    {Object.entries(FEATURE_LABEL).map(([k, label]) => {
                      const v = Math.round((t.score_breakdown?.[k] ?? 0) * 100);
                      return (
                        <div key={k} className="flex items-center gap-2">
                          <span className="w-36 shrink-0 text-[#6A4A4C]">{label}</span>
                          <span className="relative h-3 flex-1 rounded-full bg-[#F4E4DE]">
                            {[25, 50, 75].map((g) => <span key={g} className="absolute top-0 h-3 w-px bg-white" style={{ left: `${g}%` }} />)}
                            <span className="absolute left-0 top-0 h-3 rounded-full bg-[#7A1F2B]" style={{ width: `${v}%` }} />
                          </span>
                          <b className="w-9 text-right">{v}</b>
                        </div>
                      );
                    })}
                  </div>
                  {(t.explanation?.shared_interests ?? []).length > 0 && (
                    <p className="mt-2 text-[#6A4A4C]">함께 나눌 이야기: <b>{t.explanation!.shared_interests!.join(", ")}</b></p>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

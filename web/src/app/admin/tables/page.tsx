import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { FEATURE_LABEL, requireAdmin } from "@/lib/admin";
import { REGION_LABEL, animalOf, byRarity, fmtDate } from "@/lib/labels";

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
      <div className="grid gap-4 md:grid-cols-2">
        {tables.map((t, i) => {
          const ages = t.table_members.map((m) => year - m.profiles.birth_year);
          const f = t.table_members.filter((m) => m.profiles.gender === "F").length;
          return (
            <Card key={t.id}>
              <div className="flex flex-wrap items-center gap-2">
                <b>#{i + 1} {REGION_LABEL[t.event_slots.region_code]}</b>
                <Badge tone={t.status === "CONFIRMED" ? "ok" : "muted"}>{t.status === "CONFIRMED" ? "확정" : t.status}</Badge>
                <span className="text-xs text-[#8B6A66]">{fmtDate(t.event_slots.starts_at)}</span>
              </div>
              <p className="mt-1 text-xs text-[#6A4A4C]">
                📍 {t.venues?.name ?? "식당 미배정 (예외함 확인)"} · {t.table_members.length}명 (여 {f} · 남 {t.table_members.length - f}) · 나이 {Math.min(...ages)}~{Math.max(...ages)}세
              </p>
              <ul className="mt-3 space-y-1 text-xs">
                {t.table_members.map((m, j) => (
                  <li key={j} className="flex items-center justify-between">
                    <span>{animalOf(byRarity(m.profiles.self_traits)[0])?.emoji} {m.profiles.name} · {year - m.profiles.birth_year}세 · {m.profiles.gender === "F" ? "여" : "남"} · {m.profiles.mbti ?? "-"}
                      {m.reallocation_count > 0 && <span className="ml-1 text-[#8B6A66]">(재배치 {m.reallocation_count})</span>}</span>
                    <span className={m.attendance === "NO_SHOW" || m.attendance === "CANCELED_LATE" ? "text-[#A2412A]" : "text-[#8B6A66]"}>{ATT[m.attendance] ?? m.attendance}</span>
                  </li>
                ))}
              </ul>
              {t.score_breakdown && (
                <div className="mt-3 border-t border-[#EFE3DC] pt-2 text-[11px]">
                  <p className="mb-1 text-[#8B6A66]">매칭 근거 · 예측 만족도 <b className="text-[#7A1F2B]">{t.score?.toFixed(2)}</b> / 5</p>
                  <div className="grid grid-cols-5 gap-1">
                    {Object.entries(FEATURE_LABEL).map(([k, label]) => (
                      <div key={k} title={label}>
                        <div className="flex h-10 flex-col justify-end overflow-hidden rounded bg-[#F4E4DE]">
                          <div className="rounded bg-[#7A1F2B]" style={{ height: `${(t.score_breakdown?.[k] ?? 0) * 100}%` }} />
                        </div>
                        <p className="mt-0.5 truncate text-center text-[#8B6A66]">{label.split(" ")[0]}</p>
                      </div>
                    ))}
                  </div>
                  {(t.explanation?.shared_interests ?? []).length > 0 && <p className="mt-1 text-[#6A4A4C]">공통 관심사: {t.explanation!.shared_interests!.join(", ")}</p>}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

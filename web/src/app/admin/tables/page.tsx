import Link from "next/link";
import { Card } from "@/components/ui";
import { FEATURE_LABEL, requireAdmin } from "@/lib/admin";
import { REGION_COLOR } from "../region-map";
import { REGION_LABEL, animalOf, byRarity } from "@/lib/labels";

type T = {
  id: string; status: string; score: number | null; confirmed_at: string | null;
  chat_rooms: { id: string; chat_messages: { count: number }[] } | null; score_breakdown: Record<string, number> | null;
  explanation: { shared_interests?: string[] } | null;
  event_slots: { starts_at: string; region_code: string }; venues: { name: string } | null;
  table_members: { user_id: string; attendance: string; reallocation_count: number;
    profiles: { name: string; birth_year: number; gender: string; mbti: string | null; self_traits: string[] | null } }[];
};

const ATT: Record<string, string> = { SCHEDULED: "예정", ATTENDED: "참석", CANCELED_EARLY: "사전취소", CANCELED_LATE: "당일취소", NO_SHOW: "노쇼" };

// 확정 테이블 + 매칭 근거 (PRD ADM-03, MAT-12: 운영자에게는 점수 구성까지 보여줌)
export default async function Tables({ searchParams }: { searchParams: Promise<{ date?: string; table?: string; region?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: slots } = await supabase.from("event_slots").select("id, starts_at").order("starts_at");
  const allDates = [...new Set((slots ?? []).map((s) => new Date(new Date(s.starts_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10)))];
  const date = sp.date ?? allDates.find((d) => d >= new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) ?? allDates[0];
  const slotIds = (slots ?? []).filter((s) => new Date(new Date(s.starts_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) === date).map((s) => s.id);

  let q = supabase.from("dining_tables")
    .select("id, status, score, confirmed_at, score_breakdown, explanation, event_slots(starts_at, region_code), venues(name), chat_rooms(id, chat_messages(count)), table_members(user_id, attendance, reallocation_count, profiles(name, birth_year, gender, mbti, self_traits))");
  q = sp.table ? q.eq("id", sp.table) : q.in("slot_id", slotIds.length ? slotIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q.order("created_at");
  const allTables = (data ?? []) as unknown as T[];
  const tables = sp.table ? allTables : sp.region ? allTables.filter((t) => t.event_slots.region_code === sp.region) : [];
  const year = new Date().getFullYear();

  // PRD 7.2 매칭 결과 필수 표시: 참가자별 희망 일정 충족·이전 만남·차단 충돌·희망 동물 충족·재배치 사유
  type Detail = { user_id: string; wanted_slot: boolean; met_before: number; conflict: boolean; desired_met: boolean; reallocation_count: number; placement_reason: string | null };
  const ids = tables.map((t) => t.id);
  const [details, { data: notis }] = await Promise.all([
    Promise.all(ids.map((id) => supabase.rpc("admin_table_detail", { p_table: id }).then((r) => [id, (r.data ?? []) as Detail[]] as const))),
    supabase.from("notifications").select("template, sent_at, last_error, payload").in("payload->>table_id", ids.length ? ids : ["-"]).limit(5000),
  ]);
  const detailOf = new Map(details);
  const NOTI_NAME: Record<string, string> = { MATCH_CONFIRMED: "확정 안내", REMINDER_D1: "전날 리마인드", REMINDER_D0: "3시간 전", FEEDBACK_REQUEST: "피드백 요청" };
  const sendState = (tid: string) => Object.entries(NOTI_NAME).map(([k, name]) => {
    const xs = (notis ?? []).filter((n) => (n.payload as { table_id?: string })?.table_id === tid && n.template === k);
    const sent = xs.filter((n) => n.sent_at).length;
    const failed = xs.some((n) => !n.sent_at && n.last_error);
    return { name, sent, total: xs.length, failed };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-bold">테이블</h1>
        <a href={`/admin/export?type=tables&date=${date}`} title="이 날짜 테이블 구성(멤버·식당·점수)을 엑셀에서 열 수 있는 파일로 받아요" className="order-last ml-auto rounded-full border border-[#E9DCD3] bg-white px-3 py-1 text-sm">⬇ {date} 테이블 엑셀(CSV)로 받기</a>
        {allDates.map((d) => (
          <Link key={d} href={`/admin/tables?date=${d}`}
                className={`rounded-full px-3 py-1 text-sm ${d === date && !sp.table ? "bg-[#7A1F2B] text-white" : "border border-[#E9DCD3] bg-white"}`}>{d}</Link>
        ))}
      </div>
      {/* 지역 4칸: 누르면 그 지역 테이블이 아래에 펼쳐짐 */}
      {!sp.table && allTables.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Object.entries(REGION_LABEL).map(([code, label]) => {
            const ts = allTables.filter((t) => t.event_slots.region_code === code);
            const act = (t: T) => t.table_members.filter((m) => !["CANCELED_EARLY", "CANCELED_LATE"].includes(m.attendance));
            const people = ts.reduce((a, t) => a + act(t).length, 0);
            const f = ts.reduce((a, t) => a + act(t).filter((m) => m.profiles.gender === "F").length, 0);
            const avg = ts.length ? ts.reduce((a, t) => a + (t.score ?? 0), 0) / ts.length : 0;
            const issues = ts.reduce((a, t) => a + t.table_members.filter((m) => ["NO_SHOW", "CANCELED_LATE", "CANCELED_EARLY"].includes(m.attendance)).length, 0);
            const col = REGION_COLOR[code];
            const active = sp.region === code;
            return (
              <Link key={code} href={`/admin/tables?date=${date}${active ? "" : `&region=${code}`}`}
                    className="rounded-2xl border-2 bg-white p-4 shadow-[0_1px_3px_rgba(74,52,38,0.08)] transition hover:shadow-md"
                    style={{ borderColor: active ? col.main : "transparent" }}>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold" style={{ color: col.main }}>{label}</span>
                  <span className="text-sm text-[#8B6A66]">{active ? "접기 ▲" : "테이블 보기 ▼"}</span>
                </div>
                <p className="mt-1 text-3xl font-bold" style={{ color: col.main }}>{ts.length}<span className="ml-1 text-sm font-normal text-[#6A4A4C]">테이블 · {people}명</span></p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full px-2 py-0.5" style={{ background: col.soft, color: col.main }}>예상 만족도 평균 {avg ? avg.toFixed(1) : "-"}/5</span>
                  <span className="rounded-full bg-[#FCE4EC] px-2 py-0.5 text-[#C2185B]">여 {f}</span>
                  <span className="rounded-full bg-[#E3F2FD] px-2 py-0.5 text-[#1565C0]">남 {people - f}</span>
                  {issues > 0 && <span className="rounded-full bg-[#FCEDE8] px-2 py-0.5 text-[#A2412A]">취소·노쇼 {issues}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {!sp.table && !sp.region && allTables.length > 0 && <p className="text-center text-sm text-[#8B6A66]">지역 칸을 누르면 그 지역 테이블이 펼쳐져요.</p>}
      {allTables.length === 0 && <Card><p className="text-sm text-[#8B6A66]">이 날짜에는 아직 만들어진 테이블이 없어요. 매칭은 화요일 24:00 이후 자동 실행돼요.</p></Card>}
      {tables.length > 0 && <p className="text-sm text-[#8B6A66]">테이블을 누르면 멤버와 이 테이블을 만든 이유가 펼쳐져요.</p>}
      <div className="space-y-2.5">
        {tables.map((t, i) => {
          // 취소한 사람은 인원·성비·나이 계산에서 뺌
          const active = t.table_members.filter((m) => !["CANCELED_EARLY", "CANCELED_LATE"].includes(m.attendance));
          const ages = (active.length ? active : t.table_members).map((m) => year - m.profiles.birth_year);
          const f = active.filter((m) => m.profiles.gender === "F").length;
          const issues = t.table_members.filter((m) => ["NO_SHOW", "CANCELED_LATE", "CANCELED_EARLY"].includes(m.attendance)).length;
          const score = t.score ?? 0;
          const grade = score >= 4.3 ? ["아주 잘 맞음", "bg-[#E3F1E4] text-[#2F6B3A]"] : score >= 4.0 ? ["잘 맞음", "bg-[#F4E4DE] text-[#7A1F2B]"] : ["보통", "bg-[#EEE9E4] text-[#8A7F77]"];
          return (
            <details key={t.id} open={!!sp.table} className="group rounded-2xl bg-white shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span className="text-base font-bold">#{i + 1} {REGION_LABEL[t.event_slots.region_code]}</span>
                <span className="text-xl tracking-tight">{t.table_members.map((m) => animalOf(byRarity(m.profiles.self_traits)[0])?.emoji ?? "🙂").join("")}</span>
                <span className="text-sm text-[#6A4A4C]">{active.length}명 · 여 {f} 남 {active.length - f} · {Math.min(...ages)}~{Math.max(...ages)}세</span>
                <span className="text-sm text-[#6A4A4C]">📍 {t.venues?.name?.replace(/^\[샘플\]\s*/, "") ?? "식당 미배정"}</span>
                <span className={`ml-auto rounded-full px-3 py-1 text-sm font-semibold ${grade[1]}`}>{grade[0]} · 예상 만족도 {score.toFixed(1)}/5</span>
                {issues > 0 && <span className="rounded-full bg-[#FCEDE8] px-3 py-1 text-sm text-[#A2412A]">취소·노쇼 {issues}</span>}
                <span className="text-[#B7A3A0] transition group-open:rotate-180">▾</span>
              </summary>
              <div className="grid gap-5 border-t border-[#EFE3DC] px-5 py-4 md:grid-cols-2">
                <ul className="space-y-2 text-sm">
                  {t.table_members.map((m, j) => (
                    <li key={j} className="flex items-start justify-between gap-2">
                      <span className="flex flex-col">
                        <span><span className="mr-1.5 text-lg">{animalOf(byRarity(m.profiles.self_traits)[0])?.emoji}</span>
                        <b>{m.profiles.name}</b> · {year - m.profiles.birth_year}세 · {m.profiles.gender === "F" ? "여" : "남"} · {m.profiles.mbti ?? "-"}</span>
                        {(() => {
                          const d = detailOf.get(t.id)?.find((x) => x.user_id === m.user_id);
                          if (!d) return null;
                          return (
                            <span className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                              <span className={d.wanted_slot ? "text-[#2F6B3A]" : "text-[#A2412A]"}>{d.wanted_slot ? "✓ 희망 일정" : "✗ 희망 일정 밖"}</span>
                              <span className={d.desired_met ? "text-[#2F6B3A]" : "text-[#8B6A66]"}>{d.desired_met ? "✓ 원하는 동물 있음" : "– 원하는 동물 없음"}</span>
                              <span className={d.met_before ? "text-[#A2412A]" : "text-[#2F6B3A]"}>{d.met_before ? `이전 만남 ${d.met_before}명` : "✓ 모두 처음"}</span>
                              <span className={d.conflict ? "text-[#A2412A]" : "text-[#2F6B3A]"}>{d.conflict ? "✗ 차단·비선호 충돌" : "✓ 충돌 없음"}</span>
                              {d.reallocation_count > 0 && <span className="text-[#8A5B00]">재배치 {d.reallocation_count}회{d.placement_reason ? ` · ${d.placement_reason}` : ""}</span>}
                            </span>
                          );
                        })()}
                      </span>
                      <span className={m.attendance === "NO_SHOW" || m.attendance === "CANCELED_LATE" ? "text-[#A2412A]" : "text-[#8B6A66]"}>{ATT[m.attendance] ?? m.attendance}</span>
                    </li>
                  ))}
                </ul>
                <div className="text-sm">
                  <p className="mb-2 font-semibold">이 테이블을 만든 이유 <span className="font-normal text-[#8B6A66]">(기준별 충족도, 각 100점 만점)</span></p>
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
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-[#FBF7F0] px-3 py-2 text-xs text-[#6A4A4C]">
                    <span>인원 <b>{active.length}명</b> {active.length >= 4 && active.length <= 6 ? "(4~6명 ✓)" : <b className="text-[#A2412A]">(4명 미만 ✗ — 처리대기함 확인)</b>}</span>
                    <span>연령 {Math.min(...ages)}~{Math.max(...ages)}세 · 차이 <b>{Math.max(...ages) - Math.min(...ages)}살</b> {Math.max(...ages) - Math.min(...ages) <= 8 ? "✓" : "✗"}</span>
                    <span>성비 여 {f} : 남 {active.length - f}</span>
                    <span>MBTI {t.table_members.map((m) => m.profiles.mbti ?? "-").join(" ")}</span>
                    <span>자동 확정 {t.confirmed_at ? new Date(t.confirmed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</span>
                    <span>단체방 {t.chat_rooms ? `✓ 메시지 ${t.chat_rooms.chat_messages?.[0]?.count ?? 0}개` : "✗ 없음"}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold">안내 발송 상태</p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                    {sendState(t.id).map((x) => (
                      <span key={x.name} className={`rounded-full px-2 py-0.5 ${x.failed ? "bg-[#FCEDE8] text-[#A2412A]" : x.total && x.sent === x.total ? "bg-[#E3F1E4] text-[#2F6B3A]" : "bg-[#EEE9E4] text-[#6A5F57]"}`}>
                        {x.name} {x.failed ? "실패" : x.total && x.sent === x.total ? "보냄" : x.total ? `예약 ${x.total - x.sent}` : "-"}
                      </span>
                    ))}
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

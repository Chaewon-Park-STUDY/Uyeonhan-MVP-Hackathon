import Link from "next/link";
import { AdminTitle, Pill, Stat, TableWrap, kstDate, shortDt, td, th } from "@/components/admin-ui";
import { GenderTag } from "@/components/admin-ui";
import { requireAdmin } from "@/lib/admin";
import { REGION_LABEL } from "@/lib/labels";

type F = { table_id: string; user_id: string; table_score: number | null; convo_score: number | null; venue_score: number | null;
  revisit_intent: number | null; recommend_intent: number | null; comment: string | null; created_at: string;
  dining_tables: { event_slots: { starts_at: string; region_code: string } | null; venues: { name: string; gender: string; birth_year: number } | null } | null };
type Pref = { kind: string; created_at: string; from: { name: string; gender: string; birth_year: number } | null; to: { name: string; gender: string; birth_year: number } | null };
type Rep = { id: string; reason: string; status: string; admin_action: string | null; created_at: string;
  reporter: { name: string; gender: string; birth_year: number } | null; reported: { name: string; gender: string; birth_year: number; restricted_until: string | null } | null };
type Blk = { created_at: string; blocker: { name: string; gender: string; birth_year: number } | null; blocked: { name: string; gender: string; birth_year: number } | null };

const ACTION: Record<string, string> = { WARNING: "경고", RESTRICTED: "30일 제한", BANNED: "영구 제한", DISMISSED: "조치 없음" };
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "-";
};

// PRD §11 피드백·안전: 만족도 요약, 개인별 비선호·차단·신고 검토
export default async function Feedback() {
  const { supabase } = await requireAdmin();
  const [{ data: fb }, { data: prefs }, { data: reps }, { data: blks }, { count: attended }] = await Promise.all([
    supabase.from("feedback").select("table_id, user_id, table_score, convo_score, venue_score, revisit_intent, recommend_intent, comment, created_at, dining_tables(event_slots(starts_at, region_code), venues(name))")
      .order("created_at", { ascending: false }).limit(2000),
    supabase.from("person_preferences").select("kind, created_at, from:profiles!person_preferences_from_user_fkey(name, gender, birth_year), to:profiles!person_preferences_to_user_fkey(name, gender, birth_year)")
      .order("created_at", { ascending: false }).limit(200),
    supabase.from("safety_reports").select("id, reason, status, admin_action, created_at, reporter:profiles!safety_reports_reporter_id_fkey(name, gender, birth_year), reported:profiles!safety_reports_reported_id_fkey(name, gender, birth_year, restricted_until)")
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("blocks").select("created_at, blocker:profiles!blocks_blocker_id_fkey(name, gender, birth_year), blocked:profiles!blocks_blocked_id_fkey(name, gender, birth_year)")
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("table_members").select("user_id", { count: "exact", head: true }).eq("attendance", "ATTENDED"),
  ]);
  const list = (fb ?? []) as unknown as F[];
  const pref = (prefs ?? []) as unknown as Pref[];
  const reports = (reps ?? []) as unknown as Rep[];
  const blocks = (blks ?? []) as unknown as Blk[];

  // 모임일별 요약
  const byDate = new Map<string, F[]>();
  for (const f of list) {
    const d = f.dining_tables?.event_slots ? kstDate(f.dining_tables.event_slots.starts_at) : "-";
    byDate.set(d, [...(byDate.get(d) ?? []), f]);
  }

  return (
    <div className="space-y-5">
      <AdminTitle title="피드백·신고" desc="사람별 선호·신고는 당사자에게 공개되지 않아요. 신고가 들어오면 두 사람은 다음 매칭에서 즉시 분리되고, 조치는 처리대기함에서 해요." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="피드백 응답률" value={attended ? `${Math.round((list.length / attended) * 100)}%` : `${list.length}건`} />
        <Stat label="테이블 만족도" value={avg(list.map((f) => f.table_score))} tone="ok" />
        <Stat label="대화 만족도" value={avg(list.map((f) => f.convo_score))} />
        <Stat label="식당 만족도" value={avg(list.map((f) => f.venue_score))} />
        <Stat label="재참여 의향" value={avg(list.map((f) => f.revisit_intent))} />
        <Stat label="추천 의향" value={avg(list.map((f) => f.recommend_intent))} />
      </div>

      <section>
        <h2 className="mb-2 font-semibold">모임일별 만족도</h2>
        <TableWrap min={720}>
          <thead><tr><th className={th}>모임일</th><th className={th}>응답</th><th className={th}>테이블</th><th className={th}>대화</th><th className={th}>식당</th><th className={th}>재참여</th><th className={th}>추천</th></tr></thead>
          <tbody>
            {byDate.size === 0 && <tr><td className={td} colSpan={7}>아직 피드백이 없어요.</td></tr>}
            {[...byDate.entries()].map(([d, xs]) => (
              <tr key={d}>
                <td className={td}>{d}</td><td className={td}>{xs.length}건</td>
                <td className={td}>{avg(xs.map((f) => f.table_score))}</td><td className={td}>{avg(xs.map((f) => f.convo_score))}</td>
                <td className={td}>{avg(xs.map((f) => f.venue_score))}</td><td className={td}>{avg(xs.map((f) => f.revisit_intent))}</td>
                <td className={td}>{avg(xs.map((f) => f.recommend_intent))}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">신고 <span className="text-sm font-normal text-[#8B6A66]">조치는 <Link href="/admin/exceptions" className="underline">처리대기함</Link>에서</span></h2>
        <TableWrap min={720}>
          <thead><tr><th className={th}>접수</th><th className={th}>신고한 사람</th><th className={th}>신고된 사람</th><th className={th}>사유</th><th className={th}>상태</th></tr></thead>
          <tbody>
            {reports.length === 0 && <tr><td className={td} colSpan={5}>신고가 없어요.</td></tr>}
            {reports.map((r) => (
              <tr key={r.id}>
                <td className={`${td} text-xs`}>{shortDt(r.created_at)}</td>
                <td className={td}>{r.reporter?.name}<GenderTag gender={r.reporter?.gender} birthYear={r.reporter?.birth_year} /></td>
                <td className={td}>{r.reported?.name}<GenderTag gender={r.reported?.gender} birthYear={r.reported?.birth_year} /></td>
                <td className={`${td} text-xs`}>{r.reason}</td>
                <td className={td}>{r.status === "OPEN" ? <Pill tone="warn">검토 대기</Pill> : <Pill tone="ok">{ACTION[r.admin_action ?? ""] ?? "처리 완료"}</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">사람별 선호 <span className="text-sm font-normal text-[#8B6A66]">다시는 = 다음 매칭에서 같은 테이블 금지</span></h2>
          <TableWrap min={420}>
            <thead><tr><th className={th}>누가</th><th className={th}>누구를</th><th className={th}>선택</th></tr></thead>
            <tbody>
              {pref.length === 0 && <tr><td className={td} colSpan={3}>아직 없어요.</td></tr>}
              {pref.map((p, i) => (
                <tr key={i}><td className={td}>{p.from?.name}<GenderTag gender={p.from?.gender} birthYear={p.from?.birth_year} /></td><td className={td}>{p.to?.name}<GenderTag gender={p.to?.gender} birthYear={p.to?.birth_year} /></td>
                  <td className={td}>{p.kind === "LIKE" ? <Pill tone="ok">또 만나고 싶어요</Pill> : <Pill tone="warn">다시는</Pill>}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">차단</h2>
          <TableWrap min={420}>
            <thead><tr><th className={th}>차단한 사람</th><th className={th}>차단된 사람</th><th className={th}>시각</th></tr></thead>
            <tbody>
              {blocks.length === 0 && <tr><td className={td} colSpan={3}>차단 기록이 없어요.</td></tr>}
              {blocks.map((b, i) => (
                <tr key={i}><td className={td}>{b.blocker?.name}<GenderTag gender={b.blocker?.gender} birthYear={b.blocker?.birth_year} /></td><td className={td}>{b.blocked?.name}<GenderTag gender={b.blocked?.gender} birthYear={b.blocked?.birth_year} /></td><td className={`${td} text-xs`}>{shortDt(b.created_at)}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">남긴 한마디</h2>
        <TableWrap min={600}>
          <tbody>
            {list.filter((f) => f.comment).slice(0, 30).map((f, i) => (
              <tr key={i}>
                <td className={`${td} w-40 text-xs text-[#8B6A66]`}>
                  {f.dining_tables?.event_slots ? `${kstDate(f.dining_tables.event_slots.starts_at).slice(5)} ${REGION_LABEL[f.dining_tables.event_slots.region_code]}` : ""}
                </td>
                <td className={td}>{f.comment}</td>
              </tr>
            ))}
            {!list.some((f) => f.comment) && <tr><td className={td}>아직 없어요.</td></tr>}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

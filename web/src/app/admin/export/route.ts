import { requireAdmin } from "@/lib/admin";
import { MATCH_LABEL, PAYMENT_LABEL, REGION_LABEL } from "@/lib/labels";

// §16 운영 추적: 신청자·테이블 목록 CSV 내보내기 (엑셀에서 바로 열림)
const csv = (rows: (string | number | null | undefined)[][]) =>
  "\uFEFF" + rows.map((r) => r.map((v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // 엑셀 수식으로 실행되지 않게
    return `"${s.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
const kst = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "");

export async function GET(req: Request) {
  const { supabase } = await requireAdmin();
  const q = new URL(req.url).searchParams;
  const type = q.get("type");
  const date = q.get("date") && q.get("date") !== "all" ? q.get("date")! : "";
  const kd = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const nameParts: string[] = [];
  let rows: (string | number | null | undefined)[][] = [];

  if (type === "tables") {
    const { data } = await supabase.from("dining_tables")
      .select("id, status, score, confirmed_at, event_slots(starts_at, region_code), venues(name), table_members(attendance, profiles(name, birth_year, gender, mbti))")
      .eq("status", "CONFIRMED").limit(5000);
    if (date) nameParts.push(`${date} 모임`);
    rows = [["테이블ID", "모임일시", "지역", "식당", "인원", "예상 만족도", "확정 시각", "멤버(이름/출생연도/성별/MBTI)"]];
    for (const t of (data ?? []) as unknown as {
      id: string; score: number | null; confirmed_at: string | null; event_slots: { starts_at: string; region_code: string } | null;
      venues: { name: string } | null; table_members: { attendance: string; profiles: { name: string; birth_year: number; gender: string; mbti: string | null } }[] }[]) {
      if (date && (!t.event_slots || kd(t.event_slots.starts_at) !== date)) continue;
      rows.push([t.id.slice(0, 8), kst(t.event_slots?.starts_at), REGION_LABEL[t.event_slots?.region_code ?? ""] ?? "", t.venues?.name, t.table_members.length, t.score,
        kst(t.confirmed_at), t.table_members.map((m) => `${m.profiles.name}/${m.profiles.birth_year}/${m.profiles.gender === "F" ? "여" : "남"}/${m.profiles.mbti ?? "-"}`).join("; ")]);
    }
  } else {
    const { data } = await supabase.from("applications")
      .select("id, submitted_at, application_status, payment_status, match_status, profiles(name, phone, birth_year, gender, job, mbti, interests), application_slots(event_slots(starts_at, region_code))")
      .neq("application_status", "DRAFT").order("submitted_at", { ascending: false }).limit(5000);
    rows = [["신청 시각", "이름", "연락처", "출생연도", "성별", "직업", "MBTI", "관심사", "희망 회차", "신청 상태", "결제 상태", "매칭 상태"]];
    for (const a of (data ?? []) as unknown as {
      id: string; submitted_at: string | null; application_status: string; payment_status: string; match_status: string;
      profiles: { name: string; phone: string | null; birth_year: number; gender: string; job: string | null; mbti: string | null; interests: string[] };
      application_slots: { event_slots: { starts_at: string; region_code: string } | null }[] }[]) {
      const p = a.profiles;
      // 화면에서 고른 조건 그대로
      const ss = a.application_slots.map((s) => s.event_slots).filter(Boolean) as { starts_at: string; region_code: string }[];
      if (date && !ss.some((s) => kd(s.starts_at) === date)) continue;
      if (q.get("region") && !ss.some((s) => s.region_code === q.get("region") && (!date || kd(s.starts_at) === date))) continue;
      if (q.get("gender") && p.gender !== q.get("gender")) continue;
      if (q.get("pay") && a.payment_status !== q.get("pay")) continue;
      if (q.get("match") && a.match_status !== q.get("match")) continue;
      if (q.get("q") && !p.name.includes(q.get("q")!)) continue;
      rows.push([kst(a.submitted_at), p.name, p.phone, p.birth_year, p.gender === "F" ? "여" : "남", p.job, p.mbti, p.interests.join("·"),
        ss.map((s) => `${kst(s.starts_at)} ${REGION_LABEL[s.region_code] ?? s.region_code}`).join("; "),
        a.application_status === "CANCELED" ? "신청 취소" : "신청 완료", PAYMENT_LABEL[a.payment_status] ?? a.payment_status,
        MATCH_LABEL[a.match_status]?.label ?? a.match_status]);
    }
  }
  if (type !== "tables") {
    if (date) nameParts.push(`${date} 모임`);
    if (q.get("region")) nameParts.push(REGION_LABEL[q.get("region")!]?.replace("/", "·") ?? "");
    if (q.get("gender")) nameParts.push(q.get("gender") === "F" ? "여" : "남");
    if (q.get("pay")) nameParts.push(PAYMENT_LABEL[q.get("pay")!] ?? "");
    if (q.get("match")) nameParts.push(MATCH_LABEL[q.get("match")!]?.label ?? "");
  }
  const title = `${type === "tables" ? "테이블" : "신청자"}_${nameParts.filter(Boolean).join("_") || "전체"}.csv`;
  const ascii = `${type === "tables" ? "tables" : "applicants"}_${date || "all"}.csv`;
  return new Response(csv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8",
               "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(title)}` },
  });
}

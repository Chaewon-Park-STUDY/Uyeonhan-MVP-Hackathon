import { requireAdmin } from "@/lib/admin";

// §16 운영 추적: 신청자·테이블 목록 CSV 내보내기 (엑셀에서 바로 열림)
const csv = (rows: (string | number | null | undefined)[][]) =>
  "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
const kst = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "");

export async function GET(req: Request) {
  const { supabase } = await requireAdmin();
  const type = new URL(req.url).searchParams.get("type");
  let rows: (string | number | null | undefined)[][] = [];

  if (type === "tables") {
    const { data } = await supabase.from("dining_tables")
      .select("id, status, score, confirmed_at, event_slots(starts_at, region_code), venues(name), table_members(attendance, profiles(name, birth_year, gender, mbti))")
      .eq("status", "CONFIRMED").limit(5000);
    rows = [["테이블ID", "모임일시", "지역", "식당", "인원", "예상 만족도", "확정 시각", "멤버(이름/출생/성별/MBTI/참석)"]];
    for (const t of (data ?? []) as unknown as {
      id: string; score: number | null; confirmed_at: string | null; event_slots: { starts_at: string; region_code: string } | null;
      venues: { name: string } | null; table_members: { attendance: string; profiles: { name: string; birth_year: number; gender: string; mbti: string | null } }[] }[]) {
      rows.push([t.id, kst(t.event_slots?.starts_at), t.event_slots?.region_code, t.venues?.name, t.table_members.length, t.score,
        kst(t.confirmed_at), t.table_members.map((m) => `${m.profiles.name}/${m.profiles.birth_year}/${m.profiles.gender}/${m.profiles.mbti ?? "-"}/${m.attendance}`).join("; ")]);
    }
  } else {
    const { data } = await supabase.from("applications")
      .select("id, submitted_at, application_status, payment_status, match_status, profiles(name, phone, birth_year, gender, job, mbti, interests), application_slots(event_slots(starts_at, region_code))")
      .neq("application_status", "DRAFT").order("submitted_at", { ascending: false }).limit(5000);
    rows = [["신청ID", "신청 시각", "이름", "연락처", "출생연도", "성별", "직업", "MBTI", "관심사", "희망 회차", "신청 상태", "결제 상태", "매칭 상태"]];
    for (const a of (data ?? []) as unknown as {
      id: string; submitted_at: string | null; application_status: string; payment_status: string; match_status: string;
      profiles: { name: string; phone: string | null; birth_year: number; gender: string; job: string | null; mbti: string | null; interests: string[] };
      application_slots: { event_slots: { starts_at: string; region_code: string } | null }[] }[]) {
      const p = a.profiles;
      rows.push([a.id, kst(a.submitted_at), p.name, p.phone, p.birth_year, p.gender, p.job, p.mbti, p.interests.join("·"),
        a.application_slots.map((s) => s.event_slots ? `${kst(s.event_slots.starts_at)} ${s.event_slots.region_code}` : "").join("; "),
        a.application_status, a.payment_status, a.match_status]);
    }
  }
  const name = `${type === "tables" ? "tables" : "applicants"}_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}

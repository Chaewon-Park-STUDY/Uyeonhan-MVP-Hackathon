"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// 운영 일정: 실시간 시계 + 다음 일정 카운트다운 + 2주 달력
// rows: 회차 날짜별 { run_date(YYYY-MM-DD), deadline(ISO, 신청 마감 = 자동 매칭), matched_at }
type Row = { run_date: string; deadline: string; matched_at: string | null };
type Ev = { at: Date; kind: "match" | "meet" | "remind" | "feedback"; label: string; date: string };

// 구글 캘린더처럼 종류별 색 (진한 색 = 글자·막대, 연한 색 = 배경)
const KIND: Record<Ev["kind"], { dot: string; chip: string; name: string; short: string }> = {
  match: { dot: "bg-[#7A1F2B]", chip: "bg-[#F6DDE0] text-[#7A1F2B] border-[#7A1F2B]", name: "신청 마감 · 자동 매칭", short: "자동 매칭" },
  remind: { dot: "bg-[#D08A00]", chip: "bg-[#FDEFC8] text-[#8A5B00] border-[#D08A00]", name: "전날 리마인드", short: "리마인드" },
  meet: { dot: "bg-[#2F7D3A]", chip: "bg-[#DCF0DE] text-[#226B2E] border-[#2F7D3A]", name: "모임", short: "저녁 모임" },
  feedback: { dot: "bg-[#3B6EA8]", chip: "bg-[#DDE9F7] text-[#2C5687] border-[#3B6EA8]", name: "노쇼 판정 · 피드백 마감", short: "노쇼 판정" },
};
// 일정을 누르면 바로 그 일을 하는 화면으로
const hrefOf = (e: Ev) => ({
  match: `/admin/runs`, remind: `/admin/messages`, meet: `/admin/tables?date=${e.date}`, feedback: `/admin/attendance?date=${e.date}`,
}[e.kind]);
const hm = (d: Date) => {
  const k = new Date(d.getTime() + 9 * 3600e3);
  return k.getUTCHours() === 0 && k.getUTCMinutes() === 0 ? "밤 12시"
    : `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
};

const kstYmd = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
// 00:00(KST)은 "전날 밤 12시"로 표기
const when = (d: Date) => {
  const k = new Date(d.getTime() + 9 * 3600e3);
  if (k.getUTCHours() === 0 && k.getUTCMinutes() === 0) {
    return new Date(d.getTime() - 60e3).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short" }) + " 밤 12시";
  }
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
};

export function Schedule({ rows }: { rows: Row[] }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const events: Ev[] = rows.flatMap((r) => {
    const meet = new Date(`${r.run_date}T19:30:00+09:00`);
    return [
      ...(r.matched_at ? [] : [{ at: new Date(r.deadline), kind: "match" as const, label: `${r.run_date.slice(5).replace("-", "/")} 모임 자동 매칭`, date: r.run_date }]),
      { at: new Date(meet.getTime() - 24 * 3600e3), kind: "remind" as const, label: "전날 리마인드 발송", date: r.run_date },
      { at: meet, kind: "meet" as const, label: "목요일 저녁 모임", date: r.run_date },
      { at: new Date(meet.getTime() + 24 * 3600e3), kind: "feedback" as const, label: "참석·노쇼 자동 판정", date: r.run_date },
    ];
  }).sort((a, b) => a.at.getTime() - b.at.getTime());

  if (!now) return <div className="h-[420px] rounded-2xl bg-white" />;   // 서버/클라이언트 시간 차이로 깜빡임 방지

  const upcoming = events.filter((e) => e.at > now).slice(0, 4);
  const next = upcoming[0];
  const left = next ? next.at.getTime() - now.getTime() : 0;
  const dd = Math.floor(left / 86400e3), hh = Math.floor((left % 86400e3) / 3600e3), mm = Math.floor((left % 3600e3) / 60e3);

  // 이번 주 월요일부터 3주
  const today = kstYmd(now);
  const base = new Date(`${today}T00:00:00+09:00`);
  const kstDow = (new Date(base.getTime() + 9 * 3600e3).getUTCDay() + 6) % 7;   // 월=0
  const start = new Date(base.getTime() - kstDow * 86400e3);
  const days = Array.from({ length: 21 }, (_, i) => kstYmd(new Date(start.getTime() + i * 86400e3 + 12 * 3600e3)));
  // "화요일 24:00" 마감은 화요일 칸에 표시 (자정 = 전날 밤 12시)
  const shown = (e: Ev) => kstYmd(new Date(e.at.getTime() - 60e3));
  const byDay = (d: string) => events.filter((e) => shown(e) === d);
  const month = Number(today.slice(5, 7));

  return (
    <section className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
      <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
        {/* 왼쪽: 시계 + 다음 일정 + 다가오는 일정 */}
        <div>
          <p className="text-xs text-[#8B6A66]">지금 (한국 시간)</p>
          <p className="font-mono text-3xl font-bold tabular-nums text-[#2E1B1E]">
            {now.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
          </p>
          <p className="text-xs text-[#6A4A4C]">{now.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" })}</p>
          {next && (
            <Link href={hrefOf(next)} className={`mt-3 block rounded-xl border-l-4 px-3 py-2.5 transition hover:brightness-95 ${KIND[next.kind].chip}`}>
              <p className="text-[11px] opacity-80">다음 일정</p>
              <p className="text-sm font-semibold">{next.label}</p>
              <p className="mt-0.5 text-xl font-bold">{dd > 0 ? `${dd}일 ` : ""}{hh}시간 {mm}분 남음</p>
              <p className="text-[11px] opacity-80">{when(next.at)}{next.kind === "match" && " · 자동 실행돼요"}</p>
            </Link>
          )}
          {upcoming.length > 1 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-[#6A4A4C]">다가오는 일정</p>
              <ul className="space-y-1.5">
                {upcoming.slice(1).map((e, i) => (
                  <li key={i}>
                    <Link href={hrefOf(e)} className={`block rounded-lg border-l-4 px-2.5 py-1.5 text-xs transition hover:brightness-95 ${KIND[e.kind].chip}`}>
                      <b>{e.label}</b><br /><span className="opacity-80">{when(e.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 오른쪽: 3주 달력 */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-lg font-bold">{month}월 운영 일정 <span className="text-xs font-normal text-[#8B6A66]">일정을 누르면 해당 화면으로 이동해요</span></p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {Object.values(KIND).map((k) => (
                <span key={k.name} className={`rounded-full border px-2 py-0.5 ${k.chip}`}>{k.name}</span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-[#EFE3DC] pb-1 text-center text-xs font-semibold">
            {["월", "화", "수", "목", "금", "토", "일"].map((d, i) => (
              <span key={d} className={i === 5 ? "text-[#3B6EA8]" : i === 6 ? "text-[#C0392B]" : "text-[#8B6A66]"}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const evs = byDay(d).sort((a, b) => a.at.getTime() - b.at.getTime());
              const isToday = d === today;
              const past = d < today;
              const dow = i % 7;
              const firstOfMonth = d.slice(8) === "01";
              return (
                <div key={d} className={`min-h-[96px] border-b border-r border-[#F4ECE6] p-1 ${dow === 0 ? "border-l" : ""} ${past ? "bg-[#FAF6F2]" : ""}`}>
                  <p className="mb-1 text-center text-xs">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${
                      isToday ? "bg-[#7A1F2B] font-bold text-white" : past ? "text-[#C9B8B3]"
                        : dow === 5 ? "text-[#3B6EA8]" : dow === 6 ? "text-[#C0392B]" : "text-[#2E1B1E]"}`}>
                      {firstOfMonth ? `${Number(d.slice(5, 7))}/1` : Number(d.slice(8))}
                    </span>
                  </p>
                  <div className={`space-y-0.5 ${past ? "opacity-45" : ""}`}>
                    {evs.map((e, j) => (
                      <Link key={j} href={hrefOf(e)} title={`${when(e.at)} · ${e.label} (눌러서 이동)`}
                            className={`block truncate rounded border-l-[3px] px-1 py-0.5 text-[10px] leading-tight transition hover:brightness-95 hover:shadow-sm ${KIND[e.kind].chip}`}>
                        <span className="font-semibold">{hm(e.at)}</span> {KIND[e.kind].short}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

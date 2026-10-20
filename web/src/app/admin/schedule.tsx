"use client";

import { useEffect, useState } from "react";

// 운영 일정: 실시간 시계 + 다음 일정 카운트다운 + 2주 달력
// rows: 회차 날짜별 { run_date(YYYY-MM-DD), deadline(ISO, 신청 마감 = 자동 매칭), matched_at }
type Row = { run_date: string; deadline: string; matched_at: string | null };
type Ev = { at: Date; kind: "match" | "meet" | "remind" | "feedback"; label: string; date: string };

const KIND: Record<Ev["kind"], { dot: string; name: string }> = {
  match: { dot: "bg-[#7A1F2B]", name: "신청 마감 · 자동 매칭" },
  remind: { dot: "bg-[#C9A227]", name: "전날 리마인드" },
  meet: { dot: "bg-[#2F6B3A]", name: "모임" },
  feedback: { dot: "bg-[#8B6A66]", name: "노쇼 판정 · 피드백 마감" },
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

  if (!now) return <div className="h-[168px] rounded-2xl bg-white" />;   // 서버/클라이언트 시간 차이로 깜빡임 방지

  const upcoming = events.filter((e) => e.at > now).slice(0, 4);
  const next = upcoming[0];
  const left = next ? next.at.getTime() - now.getTime() : 0;
  const dd = Math.floor(left / 86400e3), hh = Math.floor((left % 86400e3) / 3600e3), mm = Math.floor((left % 3600e3) / 60e3);

  // 이번 주 월요일부터 14일
  const today = kstYmd(now);
  const base = new Date(`${today}T00:00:00+09:00`);
  const kstDow = (new Date(base.getTime() + 9 * 3600e3).getUTCDay() + 6) % 7;   // 월=0
  const start = new Date(base.getTime() - kstDow * 86400e3);
  const days = Array.from({ length: 14 }, (_, i) => kstYmd(new Date(start.getTime() + i * 86400e3 + 12 * 3600e3)));
  // "화요일 24:00" 마감은 화요일 칸에 표시 (자정 = 전날 밤 12시)
  const shown = (e: Ev) => kstYmd(new Date(e.at.getTime() - 60e3));
  const byDay = (d: string) => events.filter((e) => shown(e) === d);

  return (
    <section className="grid gap-4 rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(74,52,38,0.08)] md:grid-cols-[260px_1fr]">
      <div>
        <p className="text-xs text-[#8B6A66]">지금 (한국 시간)</p>
        <p className="font-mono text-3xl font-bold tabular-nums text-[#2E1B1E]">
          {now.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </p>
        <p className="text-xs text-[#6A4A4C]">{now.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" })}</p>
        {next && (
          <div className="mt-3 rounded-xl bg-[#FBF1EC] px-3 py-2.5">
            <p className="text-[11px] text-[#8B6A66]">다음 일정</p>
            <p className="text-sm font-semibold">{next.label}</p>
            <p className="mt-0.5 text-lg font-bold text-[#7A1F2B]">
              {dd > 0 ? `${dd}일 ` : ""}{hh}시간 {mm}분 남음
            </p>
            <p className="text-[11px] text-[#8B6A66]">
              {when(next.at)}
              {next.kind === "match" && " · 자동 실행돼요"}
            </p>
          </div>
        )}
      </div>

      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-[#8B6A66]">
          {["월", "화", "수", "목", "금", "토", "일"].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((d) => {
            const evs = byDay(d);
            const isToday = d === today;
            const past = d < today;
            return (
              <div key={d} title={evs.map((e) => e.label).join(", ")}
                   className={`min-h-[52px] rounded-lg border px-1.5 py-1 text-left ${isToday ? "border-[#7A1F2B] bg-[#FBF1EC]" : "border-[#EFE3DC]"} ${past ? "opacity-50" : ""}`}>
                <p className={`text-xs ${isToday ? "font-bold text-[#7A1F2B]" : ""}`}>{Number(d.slice(8))}</p>
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {evs.map((e, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${KIND[e.kind].dot}`} />)}
                </div>
                {evs.some((e) => e.kind === "meet") && <p className="mt-0.5 text-[9px] font-semibold text-[#2F6B3A]">모임</p>}
                {evs.some((e) => e.kind === "match") && <p className="mt-0.5 text-[9px] font-semibold text-[#7A1F2B]">매칭</p>}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#6A4A4C]">
          {Object.values(KIND).map((k) => (
            <span key={k.name} className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />{k.name}</span>
          ))}
        </div>
        {upcoming.length > 1 && (
          <ul className="mt-2 space-y-0.5 text-xs text-[#6A4A4C]">
            {upcoming.slice(1).map((e, i) => (
              <li key={i}>
                <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${KIND[e.kind].dot}`} />
                {when(e.at)} · {e.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

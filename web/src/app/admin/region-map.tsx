// 지역 지도: 서울 4개 운영 지역의 신청·확정 현황 + 서울 밖 대기 명단(확장 수요)
// 외부 지도 타일 없이 직접 그린 개략도

type Region = { code: string; label: string; apps: number; tables: number };
type Demand = { area: string; people: number };

// 지도 위 위치 (실제 지리 순서를 지킨 개략 배치 — 서로 겹치지 않게)
const POS: Record<string, [number, number]> = {
  HONGDAE: [140, 150], EULJIRO: [300, 110], GANGNAM: [290, 290], JAMSIL: [445, 250],
};
const OUTSIDE: [RegExp, [number, number], string][] = [
  [/일산|고양/, [40, 45], "일산"],
  [/인천|부평|송도/, [28, 240], "인천"],
  [/부천/, [70, 360], "부천"],
  [/수원|인계|영통/, [230, 410], "수원"],
  [/분당|판교|성남/, [420, 395], "분당·판교"],
];
const W = 580, H = 440;
const RIVER = "M0,215 C70,200 130,190 190,212 S300,235 360,208 S480,190 580,170";

export function RegionMap({ regions, demand, threshold, dateLabel }: {
  regions: Region[]; demand: Demand[]; threshold: number; dateLabel: string;
}) {
  const maxApps = Math.max(1, ...regions.map((r) => r.apps));
  const outside = new Map<string, { pos: [number, number]; people: number }>();
  for (const d of demand) {
    const hit = OUTSIDE.find(([re]) => re.test(d.area));
    if (!hit) continue;
    const cur = outside.get(hit[2]) ?? { pos: hit[1], people: 0 };
    cur.people += d.people;
    outside.set(hit[2], cur);
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="지역별 신청 현황 지도">
        <rect width={W} height={H} rx="16" fill="#FBF7F0" />
        {/* 서울 영역(개략) */}
        <ellipse cx="290" cy="200" rx="215" ry="150" fill="#F4E4DE" opacity=".7" />
        <text x="140" y="80" fontSize="14" fill="#B7A3A0" fontWeight="700">서울</text>
        {/* 한강 */}
        <path d={RIVER} fill="none" stroke="#A9C7DD" strokeWidth="10" strokeLinecap="round" opacity=".8" />
        <text x="520" y="168" fontSize="11" fill="#7FA3BE">한강</text>

        {/* 서울 밖 대기 명단 */}
        {[...outside.entries()].map(([name, o]) => {
          const [x, y] = o.pos;
          const r = 8 + Math.min(10, o.people * 1.5);
          const ready = o.people >= threshold;
          return (
            <g key={name}>
              <circle cx={x} cy={y} r={r} fill="none" stroke={ready ? "#7A1F2B" : "#B7A3A0"} strokeWidth="1.5" strokeDasharray="4 3" />
              <circle cx={x} cy={y} r="3" fill={ready ? "#7A1F2B" : "#B7A3A0"} />
              <text x={x + r + 6} y={y - 2} fontSize="12" fill="#6A4A4C" fontWeight="600">{name}</text>
              <text x={x + r + 6} y={y + 13} fontSize="11" fill={ready ? "#7A1F2B" : "#8B6A66"} fontWeight="600">
                대기 {o.people}/{threshold}명{ready ? " · 개설 검토" : ""}
              </text>
            </g>
          );
        })}

        {/* 서울 운영 지역 */}
        {regions.map((r) => {
          const [x, y] = POS[r.code] ?? [290, 200];
          const rad = 18 + (r.apps / maxApps) * 20;
          return (
            <g key={r.code}>
              <circle cx={x} cy={y} r={rad} fill="#7A1F2B" opacity=".18" />
              <circle cx={x} cy={y} r={rad * 0.62} fill="#7A1F2B" />
              <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fill="#FBF7F0" fontWeight="700">{r.apps}</text>
              <text x={x} y={y - rad - 8} textAnchor="middle" fontSize="13" fill="#2E1B1E" fontWeight="700">{r.label}</text>
              <text x={x} y={y + rad + 15} textAnchor="middle" fontSize="11" fill="#6A4A4C">테이블 {r.tables}개</text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-[#8B6A66]">
        {dateLabel} 회차 기준 · 빨간 원 숫자 = 신청자 수(클수록 많음) · 점선 원 = 서울 밖 대기 명단
      </p>
    </div>
  );
}

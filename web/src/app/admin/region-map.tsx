// 지역 지도: 실제 위경도 기준 서울 경계·한강 위에 4개 운영 지역 + 서울 밖 대기 명단
// 외부 지도 타일 없이 직접 그림 (경계·강은 주요 지점을 이은 개략선)

type Region = { code: string; label: string; apps: number; tables: number };
type Demand = { area: string; people: number };

// 지역별 색 (구분이 잘 되게 서로 다른 계열)
export const REGION_COLOR: Record<string, { main: string; soft: string }> = {
  HONGDAE: { main: "#D9485F", soft: "#F9DCE1" },
  EULJIRO: { main: "#2F6FB3", soft: "#DBE8F6" },
  GANGNAM: { main: "#2E8B57", soft: "#D9EFE2" },
  JAMSIL: { main: "#C98A12", soft: "#F8EBCB" },
};

const POS: Record<string, [number, number]> = {           // [경도, 위도]
  HONGDAE: [126.923, 37.556], EULJIRO: [126.991, 37.566], GANGNAM: [127.028, 37.498], JAMSIL: [127.1, 37.513],
};
// 라벨 방향 (겹치지 않게)
const LABEL_SIDE: Record<string, "left" | "right" | "top" | "bottom"> = { HONGDAE: "bottom", EULJIRO: "top", GANGNAM: "bottom", JAMSIL: "right" };

const OUTSIDE: [RegExp, [number, number], string][] = [
  [/일산|고양/, [126.77, 37.66], "일산"],
  [/인천|부평|송도/, [126.70, 37.46], "인천"],
  [/부천/, [126.78, 37.50], "부천"],
  [/수원|인계|영통/, [127.02, 37.27], "수원"],
  [/분당|판교|성남/, [127.12, 37.38], "분당·판교"],
];

const LON0 = 126.62, LON1 = 127.22, LAT0 = 37.24, LAT1 = 37.72;
const W = 560, H = 565;
const xy = ([lon, lat]: [number, number]) => [((lon - LON0) / (LON1 - LON0)) * W, ((LAT1 - lat) / (LAT1 - LAT0)) * H] as const;
const path = (pts: [number, number][], close = false) =>
  pts.map((p, i) => `${i ? "L" : "M"}${xy(p)[0].toFixed(1)},${xy(p)[1].toFixed(1)}`).join(" ") + (close ? " Z" : "");

// 서울시 경계 (개략)
const SEOUL: [number, number][] = [
  [126.80, 37.585], [126.84, 37.62], [126.88, 37.64], [126.93, 37.65], [126.96, 37.68], [127.00, 37.70], [127.04, 37.69],
  [127.08, 37.69], [127.10, 37.66], [127.11, 37.63], [127.13, 37.60], [127.17, 37.58], [127.185, 37.555], [127.17, 37.53],
  [127.15, 37.50], [127.13, 37.47], [127.09, 37.455], [127.05, 37.45], [127.03, 37.43], [126.99, 37.44], [126.95, 37.45],
  [126.91, 37.44], [126.88, 37.465], [126.85, 37.485], [126.82, 37.49], [126.795, 37.52], [126.77, 37.55], [126.78, 37.57],
];
// 한강 (김포 → 양화 → 여의도 → 한남 → 압구정 → 잠실 → 광나루)
const RIVER: [number, number][] = [
  [126.66, 37.63], [126.74, 37.60], [126.80, 37.585], [126.86, 37.56], [126.90, 37.545], [126.93, 37.532], [126.965, 37.522],
  [127.00, 37.522], [127.03, 37.528], [127.06, 37.53], [127.09, 37.522], [127.11, 37.535], [127.13, 37.555], [127.17, 37.565], [127.22, 37.57],
];

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
        <rect width={W} height={H} rx="16" fill="#F7F4EE" />
        <path d={path(SEOUL, true)} fill="#FFFFFF" stroke="#CDBFB5" strokeWidth="1.5" strokeLinejoin="round" />
        <text x={xy([126.99, 37.675])[0]} y={xy([126.99, 37.675])[1]} textAnchor="middle" fontSize="14" fill="#B7A3A0" fontWeight="700" letterSpacing="4">서울</text>
        <path d={path(RIVER)} fill="none" stroke="#9CC3E0" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <text x={xy([126.76, 37.595])[0]} y={xy([126.76, 37.595])[1] + 22} fontSize="11" fill="#6F9CC0" fontWeight="600">한강</text>

        {[...outside.entries()].map(([name, o]) => {
          const [x, y] = xy(o.pos);
          const r = 7 + Math.min(10, o.people * 1.5);
          const ready = o.people >= threshold;
          const c = ready ? "#7A1F2B" : "#9C8A86";
          return (
            <g key={name}>
              <circle cx={x} cy={y} r={r} fill={ready ? "#F6DDE0" : "#EFEAE6"} stroke={c} strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={x + r + 5} y={y - 1} fontSize="12" fill="#4A3436" fontWeight="600">{name}</text>
              <text x={x + r + 5} y={y + 13} fontSize="11" fill={c}>대기 {o.people}/{threshold}명{ready ? " · 개설 검토" : ""}</text>
            </g>
          );
        })}

        {regions.map((r) => {
          const [x, y] = xy(POS[r.code] ?? [127, 37.55]);
          const rad = 14 + (r.apps / maxApps) * 14;
          const col = REGION_COLOR[r.code] ?? { main: "#7A1F2B", soft: "#F4E4DE" };
          const side = LABEL_SIDE[r.code] ?? "top";
          const lx = side === "left" ? x - rad - 10 : side === "right" ? x + rad + 10 : x;
          const ly = side === "top" ? y - rad - 24 : side === "bottom" ? y + rad + 20 : y - 4;
          const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
          return (
            <g key={r.code}>
              <circle cx={x} cy={y} r={rad + 6} fill={col.soft} opacity=".9" />
              <circle cx={x} cy={y} r={rad} fill={col.main} />
              <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fill="#fff" fontWeight="800">{r.apps}</text>
              <text x={lx} y={ly} textAnchor={anchor} fontSize="13" fill={col.main} fontWeight="800">{r.label}</text>
              <text x={lx} y={ly + 15} textAnchor={anchor} fontSize="11" fill="#6A4A4C">테이블 {r.tables}개</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
        {regions.map((r) => {
          const col = REGION_COLOR[r.code];
          return (
            <div key={r.code} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: col?.soft }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: col?.main }} />
              <b style={{ color: col?.main }}>{r.label}</b>
              <span className="ml-auto text-[#4A3436]">{r.apps}명 · {r.tables}테이블</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-[#8B6A66]">
        {dateLabel} 회차 기준 · 원 안 숫자 = 그 지역을 고른 신청자(여러 지역을 고르면 각각 셈) · 점선 = 서울 밖 대기 명단
      </p>
    </div>
  );
}

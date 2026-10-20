// 브랜드 일러스트: 위에서 내려다본 둥근 저녁 식탁 + 촛불 + 접시 6개 + 동물 카드 손님들
// (직접 그린 SVG — 사진·외부 이미지 없이 "4~6명 + 동물 카드" 콘셉트를 한 장으로)

const GUESTS = ["🐻", "🦦", "🦉", "🐶", "🐱", "🦁"];

export function TableIllustration({ className = "w-64", guests = GUESTS }: { className?: string; guests?: string[] }) {
  const n = guests.length;
  const seats = guests.map((g, i) => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    return { g, a, px: 120 + Math.cos(a) * 62, py: 120 + Math.sin(a) * 62, gx: 120 + Math.cos(a) * 104, gy: 120 + Math.sin(a) * 104 };
  });
  return (
    <svg viewBox="0 0 240 240" className={className} role="img" aria-label="동물 손님들이 둘러앉은 저녁 식탁 그림">
      <defs>
        <radialGradient id="cloth" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#9A2F3D" />
          <stop offset="100%" stopColor="#6A1A25" />
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F3D58A" stopOpacity=".55" />
          <stop offset="100%" stopColor="#F3D58A" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 손님 자리 방석 */}
      {seats.map((s, i) => (
        <circle key={`c${i}`} cx={s.gx} cy={s.gy} r="17" fill="#F4E4DE" stroke="#C9A227" strokeWidth="1" />
      ))}

      {/* 식탁 */}
      <circle cx="120" cy="120" r="86" fill="url(#cloth)" />
      <circle cx="120" cy="120" r="80" fill="none" stroke="#C9A227" strokeWidth="1" strokeDasharray="2 4" opacity=".7" />

      {/* 접시 + 포크·나이프 */}
      {seats.map((s, i) => {
        const deg = (s.a * 180) / Math.PI + 90;
        return (
          <g key={`p${i}`} transform={`translate(${s.px} ${s.py}) rotate(${deg})`}>
            <circle r="15" fill="#FBF7F0" />
            <circle r="10" fill="none" stroke="#E9DCD3" strokeWidth="1.4" />
            <line x1="-20" y1="-8" x2="-20" y2="8" stroke="#E6C56A" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="20" y1="-8" x2="20" y2="8" stroke="#E6C56A" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="13" cy="-15" r="3.2" fill="#FBF7F0" opacity=".85" />
          </g>
        );
      })}

      {/* 가운데 촛불 */}
      <circle cx="120" cy="120" r="34" fill="url(#glow)" className="animate-shimmer" />
      <rect x="115" y="112" width="10" height="20" rx="2" fill="#FBF7F0" />
      <path d="M120 98c4 5 5 9 0 14-5-5-4-9 0-14z" fill="#F3B23A" className="animate-shimmer" />
      <circle cx="120" cy="134" r="9" fill="none" stroke="#C9A227" strokeWidth="1.4" />

      {/* 동물 손님 */}
      {seats.map((s, i) => (
        <text key={`g${i}`} x={s.gx} y={s.gy + 7} textAnchor="middle" fontSize="20">{s.g}</text>
      ))}
    </svg>
  );
}

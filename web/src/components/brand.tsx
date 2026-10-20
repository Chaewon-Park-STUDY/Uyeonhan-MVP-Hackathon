// 우연한 식탁 브랜드 (FAQ Q12: 로고 원본이 없어 공식 포스터를 참고해 재현)
//   심볼: 포크 | 이중 테두리 접시 | 스푼 + 아래 월계수 가지
//   워드마크: 마루부리 "우연한 식탁" (포스터와 같은 결의 현대 명조)

export function BrandSymbol({ className = "h-8 w-12", color = "currentColor", laurel = true }: {
  className?: string; color?: string; laurel?: boolean;
}) {
  return (
    <svg viewBox="0 0 120 84" className={className} fill="none" stroke={color} strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* 포크 */}
      <path d="M14 8v16M20 8v16M26 8v16M14 24c0 5 12 5 12 0M20 28v38" />
      {/* 접시 */}
      <circle cx="60" cy="36" r="24" />
      <circle cx="60" cy="36" r="16" strokeWidth="1.6" />
      {/* 스푼 */}
      <ellipse cx="100" cy="17" rx="6" ry="9" />
      <path d="M100 26v40" />
      {laurel && (
        <g strokeWidth="1.5">
          <path d="M42 76c8-5 28-5 36 0" />
          <path d="M48 73c-2-4-6-5-9-4 2 3 5 5 9 4zM55 71c-1-4-5-6-8-5 1 3 4 6 8 5z" />
          <path d="M72 73c2-4 6-5 9-4-2 3-5 5-9 4zM65 71c1-4 5-6 8-5-1 3-4 6-8 5z" />
        </g>
      )}
    </svg>
  );
}

export function Wordmark({ className = "text-lg" }: { className?: string }) {
  return <span className={`font-brand font-bold tracking-tight ${className}`}>우연한 식탁</span>;
}

// 왁스 실링 (초대장 봉투용): 골드 실링 + 버건디 심볼
export function WaxSeal({ size = 88 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id="seal" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#E6C56A" />
          <stop offset="60%" stopColor="#C9A227" />
          <stop offset="100%" stopColor="#9C7A12" />
        </radialGradient>
      </defs>
      {/* 녹은 밀랍처럼 울퉁불퉁한 가장자리 */}
      <path fill="url(#seal)"
            d="M50 3c6 0 8 4 13 5s10-1 13 3 2 9 5 13 8 5 9 10-3 8-2 13 5 9 3 14-7 6-9 10-1 10-5 13-10 0-14 3-7 9-13 9-8-5-13-6-10 2-14-2-1-9-4-13-9-5-10-10 4-8 3-13-6-8-4-13 7-6 9-10 0-10 4-13 10 0 14-3 6-9 12-9z" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="#8E6E0E" strokeWidth="1.2" opacity=".6" />
      <g transform="translate(22 30) scale(0.47)">
        <BrandSymbolPaths color="#5E1520" />
      </g>
    </svg>
  );
}

function BrandSymbolPaths({ color }: { color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round">
      <path d="M14 8v16M20 8v16M26 8v16M14 24c0 5 12 5 12 0M20 28v38" />
      <circle cx="60" cy="36" r="24" />
      <circle cx="60" cy="36" r="16" strokeWidth="3" />
      <ellipse cx="100" cy="17" rx="6" ry="9" />
      <path d="M100 26v40" />
    </g>
  );
}

// 포스터의 아치 + 마름모 장식
export function Arch({ className = "w-40 text-[#C9A227]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 30" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M10 28C50 2 150 2 190 28" />
    </svg>
  );
}

export function DiamondRule({ className = "text-[#C9A227]" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-hidden="true">
      <span className="h-px flex-1 bg-current opacity-60" />
      <span className="h-1.5 w-1.5 rotate-45 bg-current" />
      <span className="h-px flex-1 bg-current opacity-60" />
    </div>
  );
}

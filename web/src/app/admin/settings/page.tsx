import { Card, Label, Submit, inputCls } from "@/components/ui";
import { FEATURE_LABEL, requireAdmin } from "@/lib/admin";
import { saveSettings } from "../actions";

// 운영 정책 설정 (PRD ADM-08): 매칭 가중치·최소 점수·정책, 시연 모드, 노쇼 보상
export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("settings").select("key, value, updated_at");
  const cfg = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, Record<string, unknown>>;
  const m = cfg.matching ?? {};
  const w = (m.weights ?? {}) as Record<string, number>;
  const comp = ((cfg.no_show_sanction?.compensation ?? {}) as { enabled?: boolean });
  const refund = cfg.refund_policy ?? {};
  const pricing = cfg.pricing ?? {};

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_320px]">
      <form action={saveSettings} className="space-y-4">
        {saved && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">저장했어요. 다음 매칭부터 적용돼요.</p>}
        <Card>
          <Label hint="합이 1이 되도록 자동으로 맞춰요. 이 값은 베이지안 학습의 출발점(사전평균)이 되고, 피드백이 쌓이면 학습값이 이를 보정해요">매칭 가중치 (선호 조건)</Label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Object.entries(FEATURE_LABEL).map(([k, label]) => (
              <label key={k} className="text-xs">
                <span className="mb-1 block text-[#6A4A4C]">{label}</span>
                <input name={`w_${k}`} type="number" step="0.05" min="0" max="1" defaultValue={w[k] ?? 0} className={`${inputCls} py-2`} />
              </label>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-xs"><span className="mb-1 block text-[#6A4A4C]">확정 최소 점수 (0~1)</span>
              <input name="min_score" type="number" step="0.05" min="0" max="1" defaultValue={Number(m.min_score ?? 0.45)} className={`${inputCls} py-2`} /></label>
            <label className="text-xs"><span className="mb-1 block text-[#6A4A4C]">최대 나이 차이 (필수 조건)</span>
              <input name="max_age_gap" type="number" min="3" max="20" defaultValue={Number(m.max_age_gap ?? 8)} className={`${inputCls} py-2`} /></label>
          </div>
          <Label hint="시뮬레이션 결과 30회차 안에서는 사후평균이 누적 손실이 가장 작아 기본값으로 둬요">매칭 정책</Label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="policy" value="mean" defaultChecked={m.policy !== "thompson"} className="accent-[#7A1F2B]" /> 사후평균 (안정적, 기본)</label>
            <label className="flex items-center gap-2"><input type="radio" name="policy" value="thompson" defaultChecked={m.policy === "thompson"} className="accent-[#7A1F2B]" /> Thompson Sampling (탐색, 새 특성을 빨리 배워야 할 때)</label>
          </div>
        </Card>
        <Card>
          <Label>운영 옵션</Label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="compensation" defaultChecked={!!comp.enabled} className="mt-1 accent-[#7A1F2B]" />
            <span>노쇼 보상 쿠폰<br /><span className="text-xs text-[#8B6A66]">노쇼가 생기면 남은 테이블 참가자에게 보상 쿠폰을 줘요.</span></span>
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="demo" defaultChecked={!!cfg.demo?.feedback_anytime} className="mt-1 accent-[#7A1F2B]" />
            <span>시연 모드<br /><span className="text-xs text-[#8B6A66]">모임 전에도 체크인·피드백을 해볼 수 있어요. 실제 운영에서는 끄세요.</span></span>
          </label>
        </Card>
        <Submit>저장하기</Submit>
      </form>

      <div className="space-y-4">
        <Card className="text-xs text-[#6A4A4C]">
          <p className="mb-2 font-semibold text-[#2E1B1E]">필수 조건 (완화하지 않음)</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>테이블 4~6명</li><li>나이 차이 {String(m.max_age_gap ?? 8)}살 이하</li>
            <li>차단·신고·&ldquo;다시는&rdquo; 관계는 같은 테이블 금지</li><li>알레르기 메뉴 식당 배정 금지</li>
          </ul>
        </Card>
        <Card className="text-xs text-[#6A4A4C]">
          <p className="mb-2 font-semibold text-[#2E1B1E]">현재 요금·환불 정책</p>
          <p>1회권 {Number((pricing.SINGLE as { price?: number })?.price ?? 9900).toLocaleString()}원 · 멤버십 1/3/6개월</p>
          <p className="mt-1">환불: 모임 주 화요일 24:00까지 100%, 이후 0% · 매칭 실패 시 100% 또는 이동</p>
          <p className="mt-1">노쇼 1점 · 당일 취소 0.5점 · 90일 2점 → 30일 제한</p>
          <p className="mt-2 text-[11px] text-[#8B6A66]">기준: {String((refund as { cutoff?: string }).cutoff ?? "")}</p>
        </Card>
      </div>
    </div>
  );
}

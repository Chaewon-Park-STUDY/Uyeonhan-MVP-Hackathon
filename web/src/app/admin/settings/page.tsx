import { Card, Label, Submit, inputCls } from "@/components/ui";
import { FEATURE_LABEL, requireAdmin } from "@/lib/admin";
import { HistoryCard, type Log } from "@/components/history-card";
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
  const pricing = cfg.pricing ?? {};
  // §16 운영 추적: 최근 변경 이력
  const [{ data: logs }, { data: shist }] = await Promise.all([
    supabase.from("audit_log").select("entity, entity_id, field, old_value, new_value, actor, at").neq("entity", "chat_messages").order("at", { ascending: false }).limit(300),
    supabase.from("settings_history").select("key, actor, at").order("at", { ascending: false }).limit(50),
  ]);

  // 이력에 나오는 신청·회원의 이름
  const appIds = [...new Set((logs ?? []).filter((l) => l.entity.startsWith("application")).map((l) => l.entity_id))];
  const profIds = [...new Set((logs ?? []).filter((l) => l.entity === "profiles").map((l) => l.entity_id)
    .concat((logs ?? []).map((l) => /user ([0-9a-f-]{36})/.exec(l.new_value ?? "")?.[1]).filter(Boolean) as string[]))];
  const [{ data: appNames }, { data: profNames }] = await Promise.all([
    supabase.from("applications").select("id, profiles(name, gender, birth_year)").in("id", appIds.length ? appIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("profiles").select("id, name, gender, birth_year").in("id", profIds.length ? profIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  type P = { name: string; gender: string; birth_year: number };
  const people: Record<string, P> = Object.fromEntries([
    ...((appNames ?? []) as unknown as { id: string; profiles: P | null }[]).filter((a) => a.profiles).map((a) => [a.id, a.profiles!]),
    ...((profNames ?? []) as ({ id: string } & P)[]).map((p) => [p.id, { name: p.name, gender: p.gender, birth_year: p.birth_year }]),
  ]);

  return (
    <div className="space-y-5">
    <div className="grid gap-5 md:grid-cols-[1fr_320px]">
      <form action={saveSettings} className="space-y-4">
        {saved && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">저장했어요. 다음 매칭부터 적용돼요.</p>}
        <Card>
          <Label hint="어떤 기준을 더 중요하게 볼지 정해요. 합이 100%가 되도록 자동으로 맞춰요. 피드백이 쌓이면 실제 만족도에 맞게 자동으로 보정돼요">매칭 기준 비중</Label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Object.entries(FEATURE_LABEL).map(([k, label]) => (
              <label key={k} className="text-xs">
                <span className="mb-1 block text-[#6A4A4C]">{label} (%)</span>
                <input name={`w_${k}`} type="number" step="5" min="0" max="100" defaultValue={Math.round((w[k] ?? 0) * 100)} className={`${inputCls} py-2`} />
              </label>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-xs"><span className="mb-1 block text-[#6A4A4C]">테이블 확정 최소 점수 (기준 충족도 100점 만점 · 낮추면 더 많이 확정, 높이면 더 까다롭게)</span>
              <input name="min_score" type="number" step="5" min="0" max="100" defaultValue={Math.round(Number(m.min_score ?? 0.45) * 100)} className={`${inputCls} py-2`} /></label>
            <label className="text-xs"><span className="mb-1 block text-[#6A4A4C]">최대 나이 차이 (필수 조건)</span>
              <input name="max_age_gap" type="number" min="3" max="20" defaultValue={Number(m.max_age_gap ?? 8)} className={`${inputCls} py-2`} /></label>
          </div>
          <Label hint="모의 실험(30주) 결과 처음 몇 달은 안정적인 방식이 만족도가 가장 높았어요">매칭 방식</Label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="policy" value="mean" defaultChecked={m.policy !== "thompson"} className="accent-[#7A1F2B]" /> 안정적으로 <span className="text-xs text-[#8B6A66]">— 지금까지 잘 맞았던 기준대로 (추천)</span></label>
            <label className="flex items-center gap-2"><input type="radio" name="policy" value="thompson" defaultChecked={m.policy === "thompson"} className="accent-[#7A1F2B]" /> 새로운 조합도 시도 <span className="text-xs text-[#8B6A66]">— 비슷한 사람만 반복될 때, 새 기준을 빨리 배워야 할 때</span></label>
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
        <p className="text-xs font-semibold text-[#8B6A66]">참고 · 바꿀 수 없는 기준</p>
        <div className="rounded-2xl border border-dashed border-[#D9C2B8] bg-[#F6EDE7] p-4 text-xs text-[#6A4A4C]">
          <p className="mb-2 font-semibold text-[#7A1F2B]">🔒 필수 조건</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>테이블 4~6명</li><li>나이 차이 {String(m.max_age_gap ?? 8)}살 이하</li>
            <li>차단·신고·&ldquo;같은 테이블 원치 않음&rdquo; 관계는 같은 테이블 금지</li><li>알레르기 메뉴 식당 배정 금지</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-dashed border-[#D9C2B8] bg-[#F6EDE7] p-4 text-xs text-[#6A4A4C]">
          <p className="mb-2 font-semibold text-[#7A1F2B]">💳 현재 요금·환불 정책</p>
          <p>1회권 {Number((pricing.SINGLE as { price?: number })?.price ?? 9900).toLocaleString()}원 · 멤버십 1/3/6개월</p>
          <p className="mt-1">환불: 모임 주 화요일 24:00까지 100%, 이후 0% · 매칭 실패 시 100% 또는 이동</p>
          <p className="mt-1">노쇼 1점 · 당일 취소 0.5점 · 90일 2점 → 30일 제한</p>
        </div>
      </div>
    </div>
    <HistoryCard logs={(logs ?? []) as Log[]} settings={(shist ?? []) as { key: string; actor: string; at: string }[]} people={people} />
    </div>
  );
}


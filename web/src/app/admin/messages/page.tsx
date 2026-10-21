import { AdminTitle, Pill, TableWrap, shortDt, td, th } from "@/components/admin-ui";
import { PendingButton } from "@/components/pending";
import { requireAdmin } from "@/lib/admin";
import { type MsgOverride, NOTI_TEMPLATES, notiText } from "@/lib/labels";
import { saveMessage } from "../actions";

type Stat = { template: string; total: number; sent: number; pending: number; failed: number; last_sent: string | null };
type ChatStat = { kind: string; total: number; rooms: number; last_at: string | null };
type Noti = { id: string; template: string; scheduled_at: string; sent_at: string | null; attempts: number; last_error: string | null; profiles: { name: string } | null };

const CHAT_KIND: Record<string, [string, string]> = {
  NOTICE: ["환영·장소 안내", "테이블 확정 즉시"], CURATION: ["이 테이블은요 (조합 큐레이션)", "테이블 확정 즉시"],
  TOPIC: ["대화 주제", "확정 즉시 + 참가자가 더 받기"], POLICY: ["참석 안내 (취소·노쇼 정책)", "첫 대화 주제 직후"],
  REMINDER: ["리마인드", "모임 하루 전 · 3시간 전"], GAME: ["아이스브레이킹 게임", "모임 시작 시각"],
};
// 예시 값으로 기본 문구 미리보기
const SAMPLE = { starts_at: "2026-10-29T10:30:00Z", region: "HONGDAE", venue: "홍대 스시 하루", amount: 9900, match_run_at: "2026-10-27T15:00:00Z", deadline: "2026-10-27T15:00:00Z" };

// PRD §11 자동 메시지 관리: 템플릿과 자동 발송 이력
export default async function Messages({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: stats }, { data: chat }, { data: recent }, { data: ov }] = await Promise.all([
    supabase.rpc("admin_message_stats"),
    supabase.rpc("admin_chat_stats"),
    supabase.from("notifications").select("id, template, scheduled_at, sent_at, attempts, last_error, profiles(name)")
      .order("scheduled_at", { ascending: false }).limit(60),
    supabase.rpc("message_overrides"),
  ]);
  const byTpl = new Map(((stats ?? []) as Stat[]).map((s) => [s.template, s]));
  const overrides = (ov ?? {}) as Record<string, MsgOverride>;
  const label = (code: string) => NOTI_TEMPLATES.find((t) => t.code === code)?.when ?? code;

  return (
    <div className="space-y-5">
      <AdminTitle title="자동 메시지" desc="모든 안내는 정해진 시점에 자동으로 나가요. 문구를 고치면 다음 발송부터 바로 바뀌어요. {날짜} {장소} {금액} {매칭시각}을 쓰면 실제 값으로 채워져요." />
      {sp.saved && <p className="rounded-xl bg-[#E3F1E4] px-4 py-3 text-sm text-[#2F6B3A]">문구를 저장했어요.</p>}

      <section>
        <h2 className="mb-2 font-semibold">앱 알림 템플릿 <span className="text-sm font-normal text-[#8B6A66]">{NOTI_TEMPLATES.length}종 · 참가자 알림함</span></h2>
        <div className="space-y-2">
          {NOTI_TEMPLATES.map((t) => {
            const s = byTpl.get(t.code);
            const def = notiText(t.code, SAMPLE);
            const o = overrides[t.code];
            return (
              <details key={t.code} className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <b className="w-36">{t.when}</b>
                  <span className="flex-1 text-[#6A4A4C]">{o?.title || def.title}</span>
                  {o && (o.title || o.body) && <Pill tone="info">수정됨</Pill>}
                  <span className="text-xs text-[#8B6A66]">보냄 {s?.sent ?? 0} · 예약 {s?.pending ?? 0}</span>
                  {(s?.failed ?? 0) > 0 && <Pill tone="warn">실패 {s!.failed}</Pill>}
                  <span className="text-xs text-[#8B6A66]">마지막 {shortDt(s?.last_sent)}</span>
                </summary>
                <form action={saveMessage} className="space-y-2 border-t border-[#F4ECE6] px-4 py-3 text-sm">
                  <input type="hidden" name="code" value={t.code} />
                  <p className="text-xs text-[#8B6A66]">보내는 때: {t.when} — {t.sample}</p>
                  <label className="block text-xs text-[#6A4A4C]">제목
                    <input name="title" defaultValue={o?.title ?? ""} placeholder={def.title} className="mt-1 w-full rounded-lg border border-[#E9DCD3] px-2 py-1.5 text-sm" />
                  </label>
                  <label className="block text-xs text-[#6A4A4C]">본문
                    <textarea name="body" defaultValue={o?.body ?? ""} placeholder={def.body} rows={2} className="mt-1 w-full rounded-lg border border-[#E9DCD3] px-2 py-1.5 text-sm" />
                  </label>
                  <div className="flex gap-2">
                    <PendingButton className="rounded-lg bg-[#7A1F2B] px-3 py-1 text-xs text-white">저장</PendingButton>
                    <span className="self-center text-[11px] text-[#8B6A66]">비워 두면 기본 문구(회색 글씨)를 써요.</span>
                  </div>
                </form>
              </details>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">단체방 자동 메시지</h2>
        <TableWrap min={620}>
          <thead><tr><th className={th}>메시지</th><th className={th}>올라가는 때</th><th className={th}>게시</th><th className={th}>단체방 수</th><th className={th}>마지막</th></tr></thead>
          <tbody>
            {Object.entries(CHAT_KIND).map(([k, [name, when]]) => {
              const c = ((chat ?? []) as ChatStat[]).find((x) => x.kind === k);
              return (
                <tr key={k}><td className={td}>{name}</td><td className={`${td} text-xs`}>{when}</td><td className={td}>{c?.total ?? 0}건</td>
                  <td className={td}>{c?.rooms ?? 0}개</td><td className={`${td} text-xs`}>{shortDt(c?.last_at)}</td></tr>
              );
            })}
          </tbody>
        </TableWrap>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">최근 발송 이력 <span className="text-sm font-normal text-[#8B6A66]">실패하면 5분마다 다시 시도, 3번 실패하면 처리대기함으로</span></h2>
        <TableWrap min={720}>
          <thead><tr><th className={th}>받는 사람</th><th className={th}>알림</th><th className={th}>예약 시각</th><th className={th}>발송</th><th className={th}>시도</th></tr></thead>
          <tbody>
            {((recent ?? []) as unknown as Noti[]).map((n) => (
              <tr key={n.id}>
                <td className={td}>{n.profiles?.name}</td>
                <td className={td}>{label(n.template)}</td>
                <td className={`${td} text-xs`}>{shortDt(n.scheduled_at)}</td>
                <td className={td}>{n.sent_at ? <Pill tone="ok">보냄 {shortDt(n.sent_at)}</Pill> : n.last_error ? <Pill tone="warn">실패 ({n.last_error})</Pill> : <Pill tone="wait">예약됨</Pill>}</td>
                <td className={td}>{n.attempts}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

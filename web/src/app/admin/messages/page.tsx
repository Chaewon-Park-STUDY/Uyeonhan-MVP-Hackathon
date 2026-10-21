import { AdminTitle, FilterChips, FilterRow, Pager, Pill, TableWrap, shortDt, td, th } from "@/components/admin-ui";
import { GenderTag } from "@/components/admin-ui";
import { PendingButton } from "@/components/pending";
import { requireAdmin } from "@/lib/admin";
import { type MsgOverride, NOTI_TEMPLATES, notiText } from "@/lib/labels";
import { saveMessage } from "../actions";

type Stat = { template: string; total: number; sent: number; pending: number; failed: number; last_sent: string | null };
type ChatStat = { kind: string; total: number; rooms: number; last_at: string | null };
type Noti = { id: string; template: string; scheduled_at: string; sent_at: string | null; attempts: number; last_error: string | null; profiles: { name: string; gender: string; birth_year: number } | null };

const CHAT_KIND: Record<string, [string, string]> = {
  NOTICE: ["환영·장소 안내", "테이블 확정 즉시"], CURATION: ["이 테이블은요 (조합 큐레이션)", "테이블 확정 즉시"],
  TOPIC: ["대화 주제", "확정 즉시 + 참가자가 더 받기"], POLICY: ["참석 안내 (취소·노쇼 정책)", "첫 대화 주제 직후"],
  REMINDER: ["리마인드", "모임 하루 전 · 3시간 전"], GAME: ["아이스브레이킹 게임", "모임 시작 시각"],
};
// 예시 값으로 기본 문구 미리보기
const SAMPLE = { starts_at: "2026-10-29T10:30:00Z", region: "HONGDAE", venue: "홍대 스시 하루", amount: 9900, match_run_at: "2026-10-27T15:00:00Z", deadline: "2026-10-27T15:00:00Z" };

// PRD §11 자동 메시지 관리: 템플릿과 자동 발송 이력
export default async function Messages({ searchParams }: { searchParams: Promise<{ saved?: string; tpl?: string; st?: string; page?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: stats }, { data: chat }, { data: recent }, { data: ov }] = await Promise.all([
    supabase.rpc("admin_message_stats"),
    supabase.rpc("admin_chat_stats"),
    supabase.from("notifications").select("id, template, scheduled_at, sent_at, attempts, last_error, profiles(name, gender, birth_year)")
      .order("scheduled_at", { ascending: false }).limit(1000),
    supabase.rpc("message_overrides"),
  ]);
  const byTpl = new Map(((stats ?? []) as Stat[]).map((s) => [s.template, s]));
  const overrides = (ov ?? {}) as Record<string, MsgOverride>;
  const allHist = (recent ?? []) as unknown as Noti[];
  const usedTpls = NOTI_TEMPLATES.map((t) => t.code).filter((c) => allHist.some((n) => n.template === c));
  const hist = allHist.filter((n) => (!sp.tpl || n.template === sp.tpl) &&
    (!sp.st || (sp.st === "sent" ? !!n.sent_at : sp.st === "failed" ? !n.sent_at && !!n.last_error : !n.sent_at && !n.last_error)));
  const page = Math.max(1, Number(sp.page) || 1);
  // 날짜 × 알림 종류로 묶기 (최신순)
  const kd = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const gmap = new Map<string, { key: string; day: string; template: string; items: Noti[] }>();
  for (const n of hist) {
    const key = `${kd(n.scheduled_at)}|${n.template}`;
    const g = gmap.get(key) ?? { key, day: kd(n.scheduled_at), template: n.template, items: [] };
    g.items.push(n);
    gmap.set(key, g);
  }
  const groups = [...gmap.values()].sort((a, b) => b.day.localeCompare(a.day) || a.template.localeCompare(b.template))
    .map((g) => ({ ...g, dayLabel: new Date(`${g.day}T12:00:00+09:00`).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }) }));
  const groupPage = groups.slice((page - 1) * 10, page * 10);
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
        <h2 className="font-semibold">자동 발송 기록</h2>
        <p className="mb-2 text-sm text-[#8B6A66]">운영자가 보낸 게 아니라, 시스템이 정해진 때에 참가자에게 <b>자동으로 보낸 앱 알림</b>이에요. 날짜·알림별로 묶었고, 누르면 받은 사람이 보여요. 실패하면 5분마다 다시 보내고, 3번 실패하면 처리대기함에 올라가요.</p>
        <div className="mb-2 space-y-2 rounded-2xl bg-white p-3 shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
          <FilterRow label="상태">
            <FilterChips base="/admin/messages" param="st" current={sp.st} keep={{ tpl: sp.tpl }}
                         options={[["", "전체"], ["sent", "보냄"], ["pending", "예약됨"], ["failed", "실패"]]} />
          </FilterRow>
          <FilterRow label="알림">
            <FilterChips base="/admin/messages" param="tpl" current={sp.tpl} keep={{ st: sp.st }}
                         options={[["", "전체"], ...usedTpls.map((c) => [c, label(c)] as [string, string])]} />
          </FilterRow>
        </div>
        <div className="space-y-2">
          {groupPage.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-[#8B6A66]">해당하는 기록이 없어요.</p>}
          {groupPage.map((g) => {
            const sent = g.items.filter((n) => n.sent_at).length;
            const failed = g.items.filter((n) => !n.sent_at && n.last_error).length;
            const pending = g.items.length - sent - failed;
            return (
              <details key={g.key} className="group rounded-2xl bg-white shadow-[0_1px_3px_rgba(74,52,38,0.08)]">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="w-28 font-semibold">{g.dayLabel}</span>
                  <span className="font-medium">{label(g.template)}</span>
                  <span className="text-[#8B6A66]">{g.items.length}명</span>
                  <span className="ml-auto flex gap-1">
                    {sent > 0 && <Pill tone="ok">보냄 {sent}</Pill>}
                    {pending > 0 && <Pill tone="wait">예약 {pending}</Pill>}
                    {failed > 0 && <Pill tone="warn">실패 {failed}</Pill>}
                  </span>
                  <span className="text-[#B7A3A0] transition group-open:rotate-180">▾</span>
                </summary>
                <div className="flex flex-wrap gap-1.5 border-t border-[#F4ECE6] px-4 py-3 text-sm">
                  {g.items.map((n) => (
                    <span key={n.id} title={n.sent_at ? `보냄 ${shortDt(n.sent_at)}` : n.last_error ? `실패: ${n.last_error}` : `예약 ${shortDt(n.scheduled_at)}`}
                          className={`rounded-full border px-2 py-0.5 ${n.sent_at ? "border-[#E9DCD3]" : n.last_error ? "border-[#E8B4A6] bg-[#FCEDE8]" : "border-dashed border-[#D9C9B8]"}`}>
                      {n.profiles?.name}<GenderTag gender={n.profiles?.gender} birthYear={n.profiles?.birth_year} />
                    </span>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
        <div className="mt-3"><Pager base="/admin/messages" page={page} total={groups.length} size={10} keep={{ tpl: sp.tpl, st: sp.st }} /></div>
      </section>
    </div>
  );
}

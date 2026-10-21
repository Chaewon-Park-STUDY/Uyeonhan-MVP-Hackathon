import { GenderTag } from "@/components/admin-ui";
import Link from "next/link";
import { Badge, Card, inputCls } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { EXCEPTION_LABEL, requireAdmin } from "@/lib/admin";
import { fmtDate } from "@/lib/labels";
import { assignVenue, resolveException, retryNotify, safetyAction, shortTable } from "../actions";
import { REGION_LABEL } from "@/lib/labels";

type Exc = { id: string; kind: string; reason: string; status: string; admin_note: string | null; created_at: string;
  resolved_at: string | null; table_id: string | null; application_id: string | null };

// 자동 처리가 안 된 건만 모이는 곳 (PRD ADM-05): 식당 배정 실패, 확정 검증 실패, 인원 미달, 신고 등
export default async function Exceptions({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const { supabase } = await requireAdmin();
  let q = supabase.from("exception_cases").select("*").order("created_at", { ascending: false }).limit(100);
  if (!all) q = q.eq("status", "OPEN");
  const { data } = await q;
  const list = (data ?? []) as Exc[];
  type Det = { reporter: string; reported: string; reason: string; reporter_gender: string; reporter_birth: number; reported_gender: string; reported_birth: number };
  const details: Record<string, Det> = {};
  await Promise.all(list.filter((e) => e.kind === "SAFETY").map(async (e) => {
    const { data: d } = await supabase.rpc("admin_safety_detail", { p_exception: e.id }).maybeSingle<Det>();
    if (d) details[e.id] = d;
  }));

  // 해결 버튼에 필요한 정보: 테이블 지역·식당 후보, 신청자 이름
  const tableIds = [...new Set(list.map((e) => e.table_id).filter(Boolean) as string[])];
  const appIds = [...new Set(list.map((e) => e.application_id).filter(Boolean) as string[])];
  const [{ data: tbls }, { data: vens }, { data: apps }] = await Promise.all([
    supabase.from("dining_tables").select("id, status, event_slots(starts_at, region_code)").in("id", tableIds.length ? tableIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("venues").select("id, name, region_code, rating").eq("is_active", true).order("rating", { ascending: false }),
    supabase.from("applications").select("id, profiles(name, gender, birth_year)").in("id", appIds.length ? appIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const tableOf = new Map(((tbls ?? []) as unknown as { id: string; status: string; event_slots: { starts_at: string; region_code: string } | null }[]).map((t) => [t.id, t]));
  const personOf = new Map(((apps ?? []) as unknown as { id: string; profiles: { name: string; gender: string; birth_year: number } | null }[]).map((a) => [a.id, a.profiles]));
  const venuesIn = (region?: string) => ((vens ?? []) as { id: string; name: string; region_code: string; rating: number | null }[]).filter((v) => v.region_code === region);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">처리대기함 {!all && <span className="text-sm font-normal text-[#8B6A66]">처리 대기 {list.length}건</span>}</h1>
        <div className="flex gap-1.5 text-sm">
          <Link href="/admin/exceptions" className={`rounded-full px-3 py-1 ${!all ? "bg-[#7A1F2B] text-white" : "border border-[#E9DCD3] bg-white"}`}>처리 대기</Link>
          <Link href="/admin/exceptions?all=1" className={`rounded-full px-3 py-1 ${all ? "bg-[#7A1F2B] text-white" : "border border-[#E9DCD3] bg-white"}`}>전체 (처리 완료 포함)</Link>
        </div>
      </div>
      <p className="text-xs text-[#8B6A66]">
        자동으로 처리하지 못한 건만 여기에 모여요. 운영자는 이것만 확인하면 돼요. (예: 알레르기 조건에 맞는 식당 없음, 취소로 4명 미만, 참가자 신고)
      </p>
      {list.length === 0 && <Card><p className="text-sm text-[#8B6A66]">처리할 건이 없어요. 모든 회차가 자동으로 운영되고 있어요. 🎉</p></Card>}
      {list.map((e) => (
        <Card key={e.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={e.kind === "SAFETY" ? "warn" : "wait"}>{EXCEPTION_LABEL[e.kind] ?? e.kind}</Badge>
            <Badge tone={e.status === "OPEN" ? "warn" : "ok"}>{e.status === "OPEN" ? "처리 대기" : "처리 완료"}</Badge>
            <span className="text-xs text-[#8B6A66]">{fmtDate(e.created_at)}</span>
            {e.table_id && <Link href={`/admin/tables?table=${e.table_id}`} className="text-xs text-[#7A1F2B] underline">테이블 보기</Link>}
          </div>
          <p className="mt-2 text-sm">{humanize(e.reason)}</p>
          {e.application_id && personOf.get(e.application_id) && (
            <p className="mt-1 text-xs text-[#6A4A4C]">대상: <b>{personOf.get(e.application_id)!.name}</b>
              <GenderTag gender={personOf.get(e.application_id)!.gender} birthYear={personOf.get(e.application_id)!.birth_year} /></p>
          )}
          {e.table_id && tableOf.get(e.table_id)?.event_slots && (
            <p className="mt-1 text-xs text-[#6A4A4C]">테이블: {fmtDate(tableOf.get(e.table_id)!.event_slots!.starts_at)} · {REGION_LABEL[tableOf.get(e.table_id)!.event_slots!.region_code]}</p>
          )}
          {e.admin_note && <p className="mt-1 text-xs text-[#2F6B3A]">메모: {e.admin_note}</p>}
          {e.kind === "SAFETY" && details[e.id] && (
            <p className="mt-2 rounded-lg bg-[#FCEDE8] px-3 py-2 text-sm">
              신고한 사람 <b>{details[e.id].reporter}</b><GenderTag gender={details[e.id].reporter_gender} birthYear={details[e.id].reporter_birth} />
              {" "}→ 신고된 사람 <b>{details[e.id].reported}</b><GenderTag gender={details[e.id].reported_gender} birthYear={details[e.id].reported_birth} /><br />
              <span className="text-[#6A4A4C]">&ldquo;{details[e.id].reason}&rdquo;</span>
              <span className="mt-1 block text-xs text-[#8B6A66]">두 사람은 이미 자동으로 서로 같은 테이블에 배정되지 않아요. 신고 내용은 상대에게 공개되지 않아요.</span>
            </p>
          )}
          {e.status === "OPEN" && e.kind === "SAFETY" && (
            <form action={safetyAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={e.id} />
              <input name="note" placeholder="확인 내용 메모 (선택)" className={`${inputCls} py-2 text-sm`} />
              <div className="flex flex-wrap gap-2">
                {[["WARNING", "경고"], ["RESTRICTED", "30일 참가 제한"], ["BANNED", "영구 제한"], ["DISMISSED", "조치 없음"]].map(([v, l]) => (
                  <PendingButton key={v} name="action" value={v} className={`rounded-xl px-4 py-2 text-sm font-semibold ${v === "BANNED" ? "bg-[#A2412A] text-white" : v === "DISMISSED" ? "border border-[#E9DCD3] bg-white" : "bg-[#7A1F2B] text-white"}`}>
                    {l}
                  </PendingButton>
                ))}
              </div>
            </form>
          )}
          {/* 바로 해결 버튼 */}
          {e.status === "OPEN" && e.kind === "VENUE" && e.table_id && (
            <form action={assignVenue} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#FBF7F0] p-3">
              <input type="hidden" name="table" value={e.table_id} />
              <span className="text-sm font-semibold">식당 직접 지정</span>
              <select name="venue" className="rounded-lg border border-[#E9DCD3] bg-white px-2 py-1.5 text-sm">
                {venuesIn(tableOf.get(e.table_id)?.event_slots?.region_code).map((v) => (
                  <option key={v.id} value={v.id}>{v.name.replace(/^\[샘플\]\s*/, "")} · ★{v.rating ?? "-"}</option>
                ))}
              </select>
              <PendingButton className="rounded-xl bg-[#7A1F2B] px-3 py-1.5 text-sm font-semibold text-white">이 식당으로 지정</PendingButton>
              <span className="w-full text-xs text-[#8B6A66]">지정하면 단체방에 장소 안내가 자동으로 올라가고 이 건은 처리 완료돼요. 알레르기 메뉴는 식당에 직접 확인해 주세요.</span>
            </form>
          )}
          {e.status === "OPEN" && e.kind === "CONFLICT" && e.table_id && e.reason.includes("4명 미만") && tableOf.get(e.table_id)?.status === "CONFIRMED" && (
            <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-[#FBF7F0] p-3">
              <form action={shortTable}><input type="hidden" name="table" value={e.table_id} /><input type="hidden" name="mode" value="KEEP" />
                <PendingButton className="rounded-xl border border-[#E9DCD3] bg-white px-3 py-1.5 text-sm font-semibold">남은 인원으로 그대로 진행</PendingButton></form>
              <form action={shortTable}><input type="hidden" name="table" value={e.table_id} /><input type="hidden" name="mode" value="DISSOLVE" />
                <PendingButton className="rounded-xl bg-[#7A1F2B] px-3 py-1.5 text-sm font-semibold text-white">테이블 다시 짜기</PendingButton></form>
              <span className="w-full text-xs text-[#8B6A66]">다시 짜면 남은 참가자에게 다른 일정·이용권 보관·전액 환불 선택지가 자동으로 가요. 필수 조건은 낮추지 않아요(FAQ Q6).</span>
            </div>
          )}
          {e.status === "OPEN" && e.kind === "NOTIFY" && e.table_id && (
            <form action={retryNotify} className="mt-3">
              <input type="hidden" name="table" value={e.table_id} />
              <PendingButton className="rounded-xl bg-[#7A1F2B] px-3 py-1.5 text-sm font-semibold text-white">안내 다시 보내기</PendingButton>
            </form>
          )}
          {e.status === "OPEN" && e.kind !== "SAFETY" && (
            <form action={resolveException} className="mt-3 flex gap-2">
              <input type="hidden" name="id" value={e.id} />
              <input name="note" placeholder="직접 처리했다면 메모 후 완료 (예: 전화로 확인함)" className={`${inputCls} py-2 text-sm`} />
              <PendingButton className="shrink-0 rounded-xl bg-[#7A1F2B] px-4 text-sm font-semibold text-white">처리 완료</PendingButton>
            </form>
          )}
        </Card>
      ))}
    </div>
  );
}

// 예전에 쌓인 사유의 영어 코드·id를 쉬운 말로
function humanize(r: string) {
  return r
    .replace(/ \/ (table|slot) [0-9a-f-]{36}/g, "")
    .replace(/TABLE_SIZE_INVALID[^/]*/, "인원이 4~6명이 아니었어요")
    .replace(/AGE_GAP_EXCEEDED[^/]*/, "나이 차이가 8살을 넘었어요")
    .replace(/EXCLUDED_PAIR_PRESENT[^/]*/, "차단·신고 관계가 있었어요")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "");
}

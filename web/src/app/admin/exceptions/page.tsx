import Link from "next/link";
import { Badge, Card, inputCls } from "@/components/ui";
import { PendingButton } from "@/components/pending";
import { EXCEPTION_LABEL, requireAdmin } from "@/lib/admin";
import { fmtDate } from "@/lib/labels";
import { resolveException } from "../actions";

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">예외함 {!all && <span className="text-sm font-normal text-[#8B6A66]">처리 대기 {list.length}건</span>}</h1>
        <Link href={all ? "/admin/exceptions" : "/admin/exceptions?all=1"} className="text-sm text-[#7A1F2B] underline">
          {all ? "처리 대기만 보기" : "처리된 것도 보기"}
        </Link>
      </div>
      <p className="text-xs text-[#8B6A66]">
        자동으로 처리하지 못한 건만 여기에 모여요. 운영자는 이것만 확인하면 돼요. (예: 알레르기 조건에 맞는 식당 없음, 취소로 4명 미만, 참가자 신고)
      </p>
      {list.length === 0 && <Card><p className="text-sm text-[#8B6A66]">처리할 예외가 없어요. 모든 회차가 자동으로 운영되고 있어요. 🎉</p></Card>}
      {list.map((e) => (
        <Card key={e.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={e.kind === "SAFETY" ? "warn" : "wait"}>{EXCEPTION_LABEL[e.kind] ?? e.kind}</Badge>
            <Badge tone={e.status === "OPEN" ? "warn" : "ok"}>{e.status === "OPEN" ? "처리 대기" : "처리 완료"}</Badge>
            <span className="text-xs text-[#8B6A66]">{fmtDate(e.created_at)}</span>
            {e.table_id && <Link href={`/admin/tables?table=${e.table_id}`} className="text-xs text-[#7A1F2B] underline">테이블 보기</Link>}
          </div>
          <p className="mt-2 text-sm">{e.reason}</p>
          {e.admin_note && <p className="mt-1 text-xs text-[#2F6B3A]">메모: {e.admin_note}</p>}
          {e.status === "OPEN" && (
            <form action={resolveException} className="mt-3 flex gap-2">
              <input type="hidden" name="id" value={e.id} />
              <input name="note" placeholder="처리 내용 (예: 대체 식당 수동 배정)" className={`${inputCls} py-2 text-sm`} />
              <PendingButton className="shrink-0 rounded-xl bg-[#7A1F2B] px-4 text-sm font-semibold text-white">처리 완료</PendingButton>
            </form>
          )}
        </Card>
      ))}
    </div>
  );
}

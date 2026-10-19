"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowser } from "@/lib/supabase/browser";

export type Msg = { id: number; sender_id: string | null; kind: string; content: string; created_at: string };
type Member = { profile_id: string; nickname: string; is_me: boolean };

const SYSTEM_STYLE: Record<string, string> = {
  NOTICE: "bg-[#FFF8F0]",
  CURATION: "bg-[#F3E6D6]",
  TOPIC: "bg-[#EEF4EA]",
  REMINDER: "bg-[#FCEDE8]",
};

export function ChatRoom({ roomId, initial, roster }: { roomId: string; initial: Msg[]; roster: Member[] }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const me = roster.find((m) => m.is_me);
  const names = Object.fromEntries(roster.map((m, i) => [m.profile_id, `${m.nickname}${dupSuffix(roster, i)}`]));

  // 서버에서 새 메시지(대화 주제 등)를 받아 오면 합치기
  useEffect(() => setMsgs((cur) => merge(cur, initial)), [initial]);

  // 실시간 수신 (Supabase Realtime, RLS 적용)
  useEffect(() => {
    const supabase = createBrowser();
    const ch = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (p) => setMsgs((cur) => merge(cur, [p.new as Msg])))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || !me || sending) return;
    setSending(true);
    setError("");
    const { data, error } = await createBrowser().from("chat_messages")
      .insert({ room_id: roomId, sender_id: me.profile_id, kind: "USER", content: content.slice(0, 500) })
      .select().single();
    setSending(false);
    if (error) return setError("보내지 못했어요. 다시 시도해 주세요.");
    setText("");
    setMsgs((cur) => merge(cur, [data as Msg]));
  }

  return (
    <div>
      <div className="space-y-2">
        {msgs.map((m) => {
          if (!m.sender_id) {
            return (
              <p key={m.id} className={`whitespace-pre-line rounded-xl px-3 py-2.5 text-sm ${SYSTEM_STYLE[m.kind] ?? "bg-[#FFF8F0]"}`}>
                {m.content}
              </p>
            );
          }
          const mine = m.sender_id === me?.profile_id;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {!mine && <span className="mb-0.5 text-[11px] text-[#9A7B66]">{names[m.sender_id] ?? "참가자"}</span>}
              <p className={`max-w-[80%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${mine ? "bg-[#B9784A] text-white" : "bg-white shadow-[0_1px_2px_rgba(74,52,38,0.08)]"}`}>
                {m.content}
              </p>
              <span className="mt-0.5 text-[10px] text-[#B3A398]">
                {new Date(m.created_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="sticky bottom-0 mt-4 flex gap-2 bg-[#FBF6EE] py-3">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="메시지 보내기"
               className="flex-1 rounded-xl border border-[#E8DCCD] bg-white px-4 py-3 outline-none focus:border-[#B9784A]" />
        <button disabled={sending || !text.trim()}
                className="rounded-xl bg-[#B9784A] px-4 font-semibold text-white disabled:opacity-50">
          {sending ? "…" : "보내기"}
        </button>
      </form>
      {error && <p className="text-xs text-[#A2412A]">{error}</p>}
    </div>
  );
}

function merge(cur: Msg[], add: Msg[]) {
  const seen = new Set(cur.map((m) => m.id));
  const out = [...cur, ...add.filter((m) => !seen.has(m.id))];
  return out.sort((a, b) => a.id - b.id);
}

// 같은 성(첫 글자)이 여러 명이면 A, B로 구분
function dupSuffix(roster: Member[], i: number) {
  const same = roster.filter((m) => m.nickname === roster[i].nickname);
  if (same.length < 2) return "";
  return " " + String.fromCharCode(65 + same.indexOf(roster[i]));
}

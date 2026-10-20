"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowser } from "@/lib/supabase/browser";

export type Msg = { id: number; sender_id: string | null; kind: string; content: string; created_at: string;
  deleted_at?: string | null };
type Member = { profile_id: string; nickname: string; is_me: boolean };

const SYSTEM_STYLE: Record<string, string> = {
  NOTICE: "bg-[#FBF1EC]",
  CURATION: "bg-[#F4E4DE]",
  TOPIC: "bg-[#EEF4EA]",
  REMINDER: "bg-[#FCEDE8]",
};

// 이모티콘: 누르면 바로 "크게" 보내기 (카카오톡 이모티콘처럼), 입력 중이면 글에 끼워 넣기
const EMOJIS = ["😀", "😂", "🥰", "😍", "🤗", "😉", "😎", "🥳", "😭", "😅", "🙏", "👍",
  "👏", "🙌", "💪", "🎉", "❤️", "🔥", "✨", "🍽️", "🍷", "🍻", "☕", "🍰"];
const ONLY_EMOJI = /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u;

export function ChatRoom({ roomId, initial, roster }: { roomId: string; initial: Msg[]; roster: Member[] }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const me = roster.find((m) => m.is_me);
  const names = Object.fromEntries(roster.map((m, i) => [m.profile_id, `${m.nickname}${dupSuffix(roster, i)}`]));

  // 서버에서 새 메시지(대화 주제 등)를 받아 오면 합치기
  useEffect(() => {
    setMsgs((cur) => merge(cur, initial));
  }, [initial]);

  // 실시간 수신: 새 메시지(INSERT) + 삭제(UPDATE)
  useEffect(() => {
    const supabase = createBrowser();
    const filter = `room_id=eq.${roomId}`;
    const ch = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter },
        (p) => setMsgs((cur) => merge(cur, [p.new as Msg])))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter },
        (p) => setMsgs((cur) => merge(cur, [p.new as Msg])))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  // 주의: 반환값이 없어야 한다 (최신 Chrome의 scrollIntoView는 Promise를 반환 → React가 정리 함수로 오인)
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  async function post(content: string) {
    if (!content || !me || sending) return;
    setSending(true);
    setError("");
    const { data, error } = await createBrowser().from("chat_messages")
      .insert({ room_id: roomId, sender_id: me.profile_id, kind: "USER", content: content.slice(0, 500) })
      .select().single();
    setSending(false);
    if (error) {
      setError("보내지 못했어요. 다시 시도해 주세요.");
      return false;
    }
    setMsgs((cur) => merge(cur, [data as Msg]));
    return true;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (await post(text.trim())) setText("");
  }

  function pickEmoji(emoji: string) {
    if (text.trim()) setText((t) => t + emoji);       // 쓰는 중이면 글에 넣기
    else {
      post(emoji);                                      // 아니면 바로 크게 보내기
      setPicker(false);
    }
  }

  async function remove(id: number) {
    setMenuFor(null);
    const { error } = await createBrowser().rpc("delete_my_message", { p_id: id });
    if (error) return setError("삭제하지 못했어요.");
    setMsgs((cur) => cur.map((m) => (m.id === id ? { ...m, content: "", deleted_at: new Date().toISOString() } : m)));
  }

  return (
    <div>
      <div className="space-y-2" onClick={() => setMenuFor(null)}>
        {msgs.map((m) => {
          if (!m.sender_id) {
            return (
              <p key={m.id} className={`whitespace-pre-line rounded-xl px-3 py-2.5 text-sm ${SYSTEM_STYLE[m.kind] ?? "bg-[#FBF1EC]"}`}>
                {m.content}
              </p>
            );
          }
          const mine = m.sender_id === me?.profile_id;
          const deleted = !!m.deleted_at;
          const big = !deleted && ONLY_EMOJI.test(m.content);
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {!mine && <span className="mb-0.5 text-[11px] text-[#8B6A66]">{names[m.sender_id] ?? "참가자"}</span>}
              <div className="relative flex max-w-[80%] items-end gap-1">
                {mine && !deleted && (
                  <button type="button" aria-label="메시지 메뉴"
                          onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}
                          className="px-1 text-xs text-[#B7A3A0]">⋯</button>
                )}
                {deleted ? (
                  <p className="rounded-2xl border border-dashed border-[#E9DCD3] px-3 py-2 text-xs text-[#B7A3A0]">삭제된 메시지예요</p>
                ) : big ? (
                  <p className="text-4xl leading-tight">{m.content}</p>
                ) : (
                  <p className={`whitespace-pre-line break-words rounded-2xl px-3 py-2 text-sm ${mine ? "bg-[#7A1F2B] text-white" : "bg-white shadow-[0_1px_2px_rgba(74,52,38,0.08)]"}`}>
                    {m.content}
                  </p>
                )}
                {menuFor === m.id && (
                  <div className="absolute -top-9 right-0 z-10 rounded-lg bg-white shadow-md" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => remove(m.id)} className="px-3 py-2 text-xs text-[#A2412A]">삭제</button>
                  </div>
                )}
              </div>
              <span className="mt-0.5 text-[10px] text-[#B7A3A0]">
                {new Date(m.created_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-0 mt-4 bg-[#FBF7F0] py-3">
        {picker && (
          <div className="mb-2 grid grid-cols-8 gap-1 rounded-xl bg-white p-2 shadow-[0_1px_3px_rgba(74,52,38,0.12)]">
            {EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => pickEmoji(e)} className="rounded-lg py-1.5 text-2xl hover:bg-[#FBF1EC]">{e}</button>
            ))}
            <p className="col-span-8 px-1 pt-1 text-[11px] text-[#B7A3A0]">빈 칸에서 누르면 크게 보내지고, 글을 쓰는 중이면 글에 들어가요.</p>
          </div>
        )}
        <form onSubmit={send} className="flex gap-2">
          <button type="button" aria-label="이모티콘" onClick={() => setPicker((v) => !v)}
                  className={`rounded-xl border px-3 text-xl ${picker ? "border-[#7A1F2B] bg-[#FBF1EC]" : "border-[#E9DCD3] bg-white"}`}>
            😊
          </button>
          <input autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="메시지 보내기"
                 className="min-w-0 flex-1 rounded-xl border border-[#E9DCD3] bg-white px-4 py-3 outline-none focus:border-[#7A1F2B]" />
          <button disabled={sending || !text.trim()}
                  className="rounded-xl bg-[#7A1F2B] px-4 font-semibold text-white disabled:opacity-50">
            {sending ? "…" : "보내기"}
          </button>
        </form>
        {error && <p className="mt-1 text-xs text-[#A2412A]">{error}</p>}
      </div>
    </div>
  );
}

// 같은 id는 새 값으로 덮어쓰기 (삭제 반영), 나머지는 추가 후 정렬
function merge(cur: Msg[], add: Msg[]) {
  const byId = new Map(cur.map((m) => [m.id, m]));
  for (const m of add) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

// 같은 성(첫 글자)이 여러 명이면 A, B로 구분
function dupSuffix(roster: Member[], i: number) {
  const same = roster.filter((m) => m.nickname === roster[i].nickname);
  if (same.length < 2) return "";
  return " " + String.fromCharCode(65 + same.indexOf(roster[i]));
}

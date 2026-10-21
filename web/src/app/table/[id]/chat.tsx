"use client";

import { useEffect, useRef, useState } from "react";
import { mainAnimal } from "@/lib/labels";
import { createBrowser } from "@/lib/supabase/browser";

export type Msg = { id: number; sender_id: string | null; kind: string; content: string; created_at: string;
  deleted_at?: string | null };
type Member = { profile_id: string; nickname: string; is_me: boolean; animals?: string[] | null; age_band?: string; canceled?: boolean };

// 운영 안내 메시지: 제목·색으로 구분하고, 한 묶음으로 접어서 참가자 대화와 섞이지 않게
const BOT: Record<string, { title: string; color: string }> = {
  WELCOME: { title: "👋 환영 인사", color: "#7A1F2B" },
  VENUE: { title: "📍 장소·예약", color: "#2F6B3A" },
  CURATION: { title: "✨ 이 테이블은요", color: "#C9A227" },
  TOPIC: { title: "💬 대화 주제", color: "#4A7FA7" },
  POLICY: { title: "📌 참석 안내", color: "#A2412A" },
  GAME: { title: "🎲 아이스브레이킹", color: "#8A5CB8" },
  REMINDER: { title: "⏰ 리마인드", color: "#C46A1F" },
  NOTICE: { title: "📢 안내", color: "#8B6A66" },
};
const botKind = (m: Msg) =>
  m.kind !== "NOTICE" ? m.kind : m.content.startsWith("📍") ? "VENUE" : m.content.includes("환영") ? "WELCOME" : "NOTICE";
// 한 줄짜리 소식(예: 한 분이 못 오게 됐어요)은 카톡처럼 가운데 회색 한 줄로
const isLine = (m: Msg) => m.kind === "NOTICE" && !m.content.includes("\n") && botKind(m) === "NOTICE";
// 처음 보내기 어려울 때 누르면 바로 입력되는 문장
const QUICK = ["안녕하세요! 목요일에 봬요 👋", "조금 늦을 것 같아요 🙏", "도착했어요! 🙌", "자리 어디쯤이세요?"];

type Block = { type: "bot"; items: Msg[] } | { type: "line"; m: Msg } | { type: "user"; m: Msg };
function toBlocks(msgs: Msg[]): Block[] {
  const out: Block[] = [];
  for (const m of msgs) {
    if (m.sender_id) out.push({ type: "user", m });
    else if (isLine(m)) out.push({ type: "line", m });
    else {
      const last = out[out.length - 1];
      if (last?.type === "bot") last.items.push(m);
      else out.push({ type: "bot", items: [m] });
    }
  }
  return out;
}

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
  const names = Object.fromEntries(roster.map((m, i) => [m.profile_id,
    `${mainAnimal(m.animals)?.emoji ?? ""} ${m.nickname}${dupSuffix(roster, i)}${m.age_band ? ` · ${m.age_band}` : ""}`.trim()]));

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
        {toBlocks(msgs).map((b, bi, all) => {
          if (b.type === "bot") return <BotBundle key={`b${b.items[0].id}`} items={b.items} openLast={bi === all.length - 1 && bi > 0} />;
          if (b.type === "line") {
            return (
              <p key={b.m.id} className="mx-auto w-fit rounded-full bg-[#EFE3DC] px-3 py-1 text-center text-xs text-[#6A4A4C]">{b.m.content}</p>
            );
          }
          const m = b.m;
          const mine = m.sender_id === me?.profile_id;
          const deleted = !!m.deleted_at;
          const big = !deleted && ONLY_EMOJI.test(m.content);
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {!mine && <span className="mb-0.5 text-[11px] text-[#8B6A66]">{names[m.sender_id!] ?? "참가자"}</span>}
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
        {!msgs.some((m) => m.sender_id) && (
          <p className="py-3 text-center text-xs text-[#8B6A66]">— 여기부터 테이블 친구들과 대화해요. 먼저 인사를 건네 보세요! —</p>
        )}
        <div ref={bottom} />
      </div>

      {me?.canceled ? (
        <p className="mt-4 rounded-xl bg-[#F4ECE6] px-4 py-3 text-center text-sm text-[#6A4A4C]">참석을 취소해서 이 단체방에는 더 이상 글을 쓸 수 없어요.</p>
      ) : (
      <div className="sticky bottom-0 mt-4 bg-[#FBF7F0] py-3">
        {picker && (
          <div className="mb-2 grid grid-cols-8 gap-1 rounded-xl bg-white p-2 shadow-[0_1px_3px_rgba(74,52,38,0.12)]">
            {EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => pickEmoji(e)} className="rounded-lg py-1.5 text-2xl hover:bg-[#FBF1EC]">{e}</button>
            ))}
            <p className="col-span-8 px-1 pt-1 text-[11px] text-[#B7A3A0]">빈 칸에서 누르면 크게 보내지고, 글을 쓰는 중이면 글에 들어가요.</p>
          </div>
        )}
        {!text && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} type="button" onClick={() => setText(q)}
                      className="shrink-0 rounded-full border border-[#E9DCD3] bg-white px-3 py-1.5 text-xs text-[#6A4A4C] hover:border-[#7A1F2B]">
                {q}
              </button>
            ))}
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
      )}
    </div>
  );
}

// 운영 안내 묶음: 제목 목록만 보이고, 누르면 내용이 펼쳐짐
function BotBundle({ items, openLast }: { items: Msg[]; openLast: boolean }) {
  const [open, setOpen] = useState<number | null>(openLast ? items[items.length - 1].id : null);
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#7A1F2B] text-sm text-white">🍽️</span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[11px] text-[#8B6A66]">우연한 식탁 운영팀 · 안내 {items.length}개 · 제목을 누르면 내용이 보여요</p>
        <div className="overflow-hidden rounded-2xl border border-[#EFE3DC] bg-white">
          {items.map((m, i) => {
            const k = BOT[botKind(m)] ?? BOT.NOTICE;
            // 같은 종류가 여러 개면 "대화 주제 2"처럼 번호
            const same = items.filter((x) => botKind(x) === botKind(m));
            const title = same.length > 1 ? `${k.title} ${same.indexOf(m) + 1}` : k.title;
            const isOpen = open === m.id;
            return (
              <div key={m.id} className={i ? "border-t border-[#F4ECE6]" : ""}>
                <button type="button" onClick={() => setOpen(isOpen ? null : m.id)}
                        className="flex w-full items-center gap-2 border-l-4 px-3 py-2.5 text-left text-sm" style={{ borderColor: k.color }}>
                  <span className="font-semibold" style={{ color: k.color }}>{title}</span>
                  <span className="ml-auto text-xs text-[#B7A3A0]">{isOpen ? "접기 ▲" : "보기 ▼"}</span>
                </button>
                {isOpen && (
                  <p className="whitespace-pre-line px-4 pb-3 text-sm leading-relaxed text-[#2E1B1E]">
                    {m.content.replace(/^(📍|📌|🎲)\s*/, "").replace(/\[샘플\]\s*/g, "")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
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

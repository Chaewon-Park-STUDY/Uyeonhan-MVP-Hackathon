"use client";
// 참가자 상담 챗봇 — 자주 묻는 질문을 키워드로 찾아 바로 답해 줌 (외부 AI 호출 없음: 비용·개인정보·오답 위험 없음)
// 답이 없거나 사진·PDF를 보내면 "운영팀 문의"로 저장 (inquiries + 비공개 파일 보관함) → 운영자 피드백·신고 화면에서 확인
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createBrowser } from "@/lib/supabase/browser";

type QA = { q: string; keys: string[]; a: string; link?: [string, string] };
const FAQ: QA[] = [
  { q: "매칭은 언제 되나요?", keys: ["매칭", "결과", "발표", "언제 알"],
    a: "모임이 있는 주 화요일 밤 12시에 신청이 마감되고, 바로 자동으로 매칭돼요. 결과는 알림으로 알려 드리고 홈에서도 볼 수 있어요.", link: ["/", "홈에서 내 신청 보기"] },
  { q: "가격이 얼마예요?", keys: ["가격", "얼마", "요금", "비용", "멤버십", "1회권", "이용권"],
    a: "1회권은 9,900원이에요. 자주 오신다면 멤버십(1개월 35,000원 · 3개월 75,000원 · 6개월 120,000원)이 더 저렴해요. 멤버십 기간에는 따로 결제 없이 신청할 수 있어요.", link: ["/apply", "신청하러 가기"] },
  { q: "취소하면 환불되나요?", keys: ["취소", "환불", "돈", "돌려"],
    a: "신청 마감(모임 주 화요일 밤 12시) 전에는 홈의 '신청 취소'로 언제든 취소할 수 있고, 1회권 결제 금액은 전액 환불돼요. 마감 후에는 매칭이 끝난 뒤라 환불되지 않아요.", link: ["/", "홈에서 취소하기"] },
  { q: "매칭이 안 되면요?", keys: ["실패", "안 되", "안되", "못", "대체", "다른 날", "옮기"],
    a: "조건에 맞는 테이블을 못 만들면 신청할 때 골라 둔 방법(다른 날짜·다른 지역으로 이동, 이용권 보관, 전액 환불)이 자동으로 적용돼요. 홈에서 직접 다른 회차를 고를 수도 있어요. 멤버십은 기간이 7일 늘어나요." },
  { q: "어떤 사람들과 만나나요?", keys: ["누구", "사람", "나이", "나이 차이", "성비", "몇 명", "몇명", "인원", "mbti", "동물"],
    a: "한 테이블은 4~6명이고, 나이 차이는 8살 이내예요. 성비·MBTI·관심사·내가 고른 동물 카드를 함께 보고 잘 어울릴 사람들로 모아요. 차단했거나 '다음엔 다른 테이블이 좋아요'를 고른 사람과는 다시 만나지 않아요." },
  { q: "식당은 어디예요?", keys: ["식당", "장소", "어디", "주소", "메뉴", "알레르기"],
    a: "매칭이 확정되면 테이블 화면에서 식당 이름·주소·시간을 볼 수 있어요. 알레르기가 있는 재료를 쓰는 식당은 자동으로 빼고 배정해요." },
  { q: "단체방은 어디 있어요?", keys: ["단체방", "채팅", "대화방", "톡"],
    a: "매칭이 확정되면 테이블마다 단체방이 자동으로 열려요. 홈의 내 테이블 카드를 누르면 들어갈 수 있어요. 대화 주제도 미리 준비해 둘게요." },
  { q: "못 가게 되면 어떡해요? (노쇼)", keys: ["노쇼", "못 가", "못가", "늦", "당일", "체크인", "벌점", "제한"],
    a: "모임 장소에 도착하면 테이블 화면에서 체크인해 주세요. 연락 없이 안 오면 노쇼 1점, 당일 취소는 0.5점이에요. 90일 안에 2점이 쌓이면 30일 동안 신청할 수 없어요. 못 가게 되면 되도록 미리 취소해 주세요." },
  { q: "불편한 사람이 있었어요", keys: ["불편", "신고", "차단", "무례", "싫", "안전"],
    a: "모임 후 피드백에서 '다음엔 다른 테이블이 좋아요'를 고르면 그 사람과는 다시 매칭되지 않아요(상대에게 알려지지 않아요). 심각한 일이었다면 같은 화면에서 신고해 주세요. 바로 차단되고 운영팀이 확인해요." },
  { q: "쿠폰은 어떻게 받아요?", keys: ["쿠폰", "할인", "초대", "추천", "친구", "코드"],
    a: "모임 후 피드백을 남기면 다음 신청에 쓸 수 있는 10% 쿠폰(14일)을 드려요. 프로필의 내 초대 코드로 친구가 가입하면 친구는 첫 신청 할인, 친구가 결제하면 나도 할인 쿠폰을 받아요.", link: ["/profile", "내 초대 코드 보기"] },
  { q: "프로필을 바꾸거나 탈퇴하고 싶어요", keys: ["프로필", "수정", "변경", "탈퇴", "정보", "삭제"],
    a: "프로필 화면에서 자리 카드(관심사·MBTI·동물 카드 등)를 고칠 수 있고, 맨 아래에서 회원 탈퇴도 할 수 있어요.", link: ["/profile", "프로필로 가기"] },
];
const QUICK = [0, 2, 3, 7, 8];

type Msg = { from: "bot" | "me"; text: string; link?: [string, string]; file?: string; ask?: string };
const HELLO: Msg = { from: "bot", text: "안녕하세요, 우연한 식탁이에요 :) 궁금한 걸 물어보거나 아래 질문을 눌러 보세요. 사진이나 PDF를 붙여 보내면 운영팀에 바로 전달돼요." };
const MAX = 5 * 1024 * 1024;
const OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

function answer(text: string): Msg {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  let best: QA | null = null, score = 0;
  for (const f of FAQ) {
    const s = f.keys.filter((k) => t.includes(k)).reduce((n, k) => n + k.length, 0); // 긴 단어가 맞을수록 우선
    if (s > score) { best = f; score = s; }
  }
  return best
    ? { from: "bot", text: best.a, link: best.link }
    : { from: "bot", text: "그 질문은 제가 바로 답하기 어려워요. 운영팀에 그대로 전달할까요?", ask: text };
}

export function HelpBot() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([HELLO]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  // 운영자 화면, 단체방(입력창과 겹침), 로그인 화면에서는 숨김
  if (path.startsWith("/admin") || path.startsWith("/table/") || path.startsWith("/login")) return null;

  const say = (...m: Msg[]) => setMsgs((xs) => [...xs, ...m]);

  // 운영팀 문의로 저장 (로그인 필요)
  const sendInquiry = async (body: string, f: File | null) => {
    setBusy(true);
    try {
      const sb = createBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { say({ from: "bot", text: "운영팀 문의는 로그인 후에 남길 수 있어요.", link: ["/login", "로그인하기"] }); return; }
      let file_path: string | null = null;
      if (f) {
        const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        file_path = `${user.id}/${Date.now()}${ext ? "." + ext : ""}`;
        const up = await sb.storage.from("inquiry-files").upload(file_path, f, { contentType: f.type });
        if (up.error) { say({ from: "bot", text: "파일을 올리지 못했어요. 5MB 이하의 사진(PNG·JPG)이나 PDF인지 확인해 주세요." }); return; }
      }
      const { error } = await sb.from("inquiries").insert({ body: body || "(파일만 보냄)", file_path, file_name: f?.name ?? null });
      if (error) { say({ from: "bot", text: "문의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }); return; }
      say({ from: "bot", text: "운영팀에 전달했어요. 확인하고 프로필에 적어 주신 연락처로 안내드릴게요. 급한 일이면 내용을 조금 더 자세히 적어 주세요." });
    } finally { setBusy(false); }
  };

  const submit = () => {
    const q = text.trim();
    if (!q && !file) return;
    const f = file;
    say({ from: "me", text: q || "파일을 보냈어요", file: f?.name });
    setText(""); setFile(null);
    if (f) sendInquiry(q, f);        // 파일이 있으면 바로 운영팀으로
    else say(answer(q));
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!OK_TYPES.includes(f.type)) { say({ from: "bot", text: "사진(PNG·JPG·WEBP·GIF)이나 PDF만 보낼 수 있어요." }); return; }
    if (f.size > MAX) { say({ from: "bot", text: "5MB 이하의 파일만 보낼 수 있어요." }); return; }
    setFile(f);
  };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="상담 열기"
                className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5 rounded-full bg-[#7A1F2B] px-5 py-3.5 text-base font-semibold text-white shadow-lg">
          💬 궁금한 점
        </button>
      )}
      {open && (
        <div className="fixed inset-x-2 bottom-2 top-16 z-50 flex flex-col overflow-hidden rounded-3xl border border-[#EFE3DC] bg-[#FBF7F0] shadow-2xl
                        sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:h-[min(720px,calc(100dvh-6rem))] sm:w-[420px]">
          <div className="flex items-center justify-between bg-[#7A1F2B] px-5 py-4 text-white">
            <div>
              <p className="text-lg font-bold">우연한 식탁 상담</p>
              <p className="text-xs text-[#F4E4DE]">자주 묻는 질문은 바로, 나머지는 운영팀이 답해요</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="닫기" className="text-2xl leading-none">✕</button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[15px]">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === "me" ? "justify-end" : ""}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${m.from === "me" ? "bg-[#7A1F2B] text-white" : "bg-white text-[#2E1B1E] shadow-[0_1px_2px_rgba(74,52,38,0.08)]"}`}>
                  {m.text}
                  {m.file && <span className="mt-1 block text-xs opacity-80">📎 {m.file}</span>}
                  {m.link && (
                    <Link href={m.link[0]} onClick={() => setOpen(false)} className="mt-1.5 block font-semibold text-[#7A1F2B] underline underline-offset-2">
                      {m.link[1]} →
                    </Link>
                  )}
                  {m.ask && (
                    <button disabled={busy} onClick={() => { const q = m.ask!; setMsgs((xs) => xs.map((x, j) => (j === i ? { ...x, ask: undefined } : x))); say({ from: "me", text: "네, 전달해 주세요" }); sendInquiry(q, null); }}
                            className="mt-2 block rounded-full bg-[#7A1F2B] px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">
                      운영팀에 전달하기
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-xs text-[#8B6A66]">보내는 중…</p>}
            <div ref={end} />
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-[#EFE3DC] px-4 pt-3">
            {QUICK.map((i) => (
              <button key={i} onClick={() => say({ from: "me", text: FAQ[i].q }, { from: "bot", text: FAQ[i].a, link: FAQ[i].link })}
                      className="rounded-full border border-[#E9DCD3] bg-white px-3 py-1 text-xs text-[#6A4A4C]">
                {FAQ[i].q}
              </button>
            ))}
          </div>
          <div className="p-3">
            {file && (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm">
                📎 <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button onClick={() => setFile(null)} className="text-[#8B6A66]" aria-label="첨부 빼기">✕</button>
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="rounded-2xl border border-[#E9DCD3] bg-white p-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="예: 환불은 언제까지 돼요?"
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
                        className="w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none" />
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => picker.current?.click()} aria-label="파일 첨부"
                        className="rounded-full px-2 py-1 text-lg text-[#8B6A66] hover:bg-[#FBF1EC]">📎</button>
                <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden"
                       onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
                <button disabled={busy || (!text.trim() && !file)} className="rounded-full bg-[#7A1F2B] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">보내기</button>
              </div>
            </form>
            <p className="mt-1.5 text-center text-[11px] text-[#B7A3A0]">자동 답변은 자주 묻는 질문 기준이에요. 정확한 내용은 운영팀 답변을 따라 주세요.</p>
          </div>
        </div>
      )}
    </>
  );
}

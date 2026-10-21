"use client";
// 참가자 상담 챗봇 — 자주 묻는 질문을 키워드로 찾아 바로 답해 줌 (외부 AI 호출 없음: 비용·개인정보·오답 위험 없음)
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
    a: "한 테이블은 4~6명이고, 나이 차이는 8살 이내예요. 성비·MBTI·관심사·내가 고른 동물 카드를 함께 보고 잘 어울릴 사람들로 모아요. 차단했거나 '다시는 만나고 싶지 않아요'를 고른 사람과는 다시 만나지 않아요." },
  { q: "식당은 어디예요?", keys: ["식당", "장소", "어디", "주소", "메뉴", "알레르기"],
    a: "매칭이 확정되면 테이블 화면에서 식당 이름·주소·시간을 볼 수 있어요. 알레르기가 있는 재료를 쓰는 식당은 자동으로 빼고 배정해요." },
  { q: "단체방은 어디 있어요?", keys: ["단체방", "채팅", "대화방", "톡"],
    a: "매칭이 확정되면 테이블마다 단체방이 자동으로 열려요. 홈의 내 테이블 카드를 누르면 들어갈 수 있어요. 대화 주제도 미리 준비해 둘게요." },
  { q: "못 가게 되면 어떡해요? (노쇼)", keys: ["노쇼", "못 가", "못가", "늦", "당일", "체크인", "벌점", "제한"],
    a: "모임 장소에 도착하면 테이블 화면에서 체크인해 주세요. 연락 없이 안 오면 노쇼 1점, 당일 취소는 0.5점이에요. 90일 안에 2점이 쌓이면 30일 동안 신청할 수 없어요. 못 가게 되면 되도록 미리 취소해 주세요." },
  { q: "불편한 사람이 있었어요", keys: ["불편", "신고", "차단", "무례", "싫", "안전"],
    a: "모임 후 피드백에서 '다시는 만나고 싶지 않아요'를 고르면 그 사람과는 다시 매칭되지 않아요(상대에게 알려지지 않아요). 심각한 일이었다면 같은 화면에서 신고해 주세요. 바로 차단되고 운영팀이 확인해요." },
  { q: "쿠폰은 어떻게 받아요?", keys: ["쿠폰", "할인", "초대", "추천", "친구", "코드"],
    a: "모임 후 피드백을 남기면 다음 신청에 쓸 수 있는 10% 쿠폰(14일)을 드려요. 프로필의 내 초대 코드로 친구가 가입하면 친구는 첫 신청 할인, 친구가 결제하면 나도 할인 쿠폰을 받아요.", link: ["/profile", "내 초대 코드 보기"] },
  { q: "프로필을 바꾸거나 탈퇴하고 싶어요", keys: ["프로필", "수정", "변경", "탈퇴", "정보", "삭제"],
    a: "프로필 화면에서 자리 카드(관심사·MBTI·동물 카드 등)를 고칠 수 있고, 맨 아래에서 회원 탈퇴도 할 수 있어요.", link: ["/profile", "프로필로 가기"] },
];
const QUICK = [0, 2, 3, 7, 8];

type Msg = { from: "bot" | "me"; text: string; link?: [string, string] };
const HELLO: Msg = { from: "bot", text: "안녕하세요, 우연한 식탁이에요. 궁금한 걸 물어보거나 아래 질문을 눌러 보세요." };

function answer(text: string): Msg {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  let best: QA | null = null, score = 0;
  for (const f of FAQ) {
    const s = f.keys.filter((k) => t.includes(k)).reduce((n, k) => n + k.length, 0); // 긴 단어가 맞을수록 우선
    if (s > score) { best = f; score = s; }
  }
  return best
    ? { from: "bot", text: best.a, link: best.link }
    : { from: "bot", text: "그 질문은 제가 아직 답하기 어려워요. 아래 자주 묻는 질문을 눌러 보시거나, 다른 말로 다시 물어봐 주세요." };
}

export function HelpBot() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([HELLO]);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  // 운영자 화면, 단체방(입력창과 겹침), 로그인 화면에서는 숨김
  if (path.startsWith("/admin") || path.startsWith("/table/") || path.startsWith("/login")) return null;

  const ask = (q: string, a?: Msg) => {
    if (!q.trim()) return;
    setMsgs((m) => [...m, { from: "me", text: q }, a ?? answer(q)]);
    setText("");
  };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="상담 열기"
                className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5 rounded-full bg-[#7A1F2B] px-4 py-3 text-sm font-semibold text-white shadow-lg">
          💬 궁금한 점
        </button>
      )}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl border border-[#EFE3DC] bg-[#FBF7F0] shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[380px]">
          <div className="flex items-center justify-between bg-[#7A1F2B] px-4 py-3 text-white">
            <p className="font-semibold">우연한 식탁 상담</p>
            <button onClick={() => setOpen(false)} aria-label="닫기" className="text-lg leading-none">✕</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-sm">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === "me" ? "justify-end" : ""}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 leading-relaxed ${m.from === "me" ? "bg-[#7A1F2B] text-white" : "bg-white text-[#2E1B1E] shadow-[0_1px_2px_rgba(74,52,38,0.08)]"}`}>
                  {m.text}
                  {m.link && (
                    <Link href={m.link[0]} onClick={() => setOpen(false)} className="mt-1.5 block font-semibold text-[#7A1F2B] underline underline-offset-2">
                      {m.link[1]} →
                    </Link>
                  )}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
            {QUICK.map((i) => (
              <button key={i} onClick={() => ask(FAQ[i].q, { from: "bot", text: FAQ[i].a, link: FAQ[i].link })}
                      className="shrink-0 rounded-full border border-[#E9DCD3] bg-white px-3 py-1 text-xs text-[#6A4A4C]">
                {FAQ[i].q}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex gap-2 border-t border-[#EFE3DC] bg-white p-2.5">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 환불은 언제까지 돼요?"
                   className="min-w-0 flex-1 rounded-full border border-[#E9DCD3] bg-[#FFFCF9] px-3 py-2 text-sm outline-none focus:border-[#7A1F2B]" />
            <button className="rounded-full bg-[#7A1F2B] px-4 text-sm font-semibold text-white">보내기</button>
          </form>
        </div>
      )}
    </>
  );
}

// 대화 주제 추천: Gemini(무료 등급) → 실패하면 템플릿
// Gemini에는 개인정보를 보내지 않는다. 공통 관심사와 E/I 비율만 보낸다.

const FALLBACK: Record<string, string[]> = {
  "운동": ["운동 말고 요즘 몸이 좋아진다고 느끼는 습관이 있나요?", "같이 해보고 싶은 운동이 있다면?"],
  "맛집·카페 탐방": ["이 근처에서 다음에 같이 가보고 싶은 곳이 있나요?", "디저트파인가요, 식사파인가요?"],
  "여행": ["여행 가서 생긴 의외의 에피소드가 있나요?", "혼자 여행과 같이 하는 여행, 어느 쪽이 좋아요?"],
  "영화·드라마": ["다시 봐도 좋은 작품이 있나요?", "주인공이 될 수 있다면 어떤 작품 속으로?"],
  "음악": ["노래방 18번이 궁금해요.", "어떤 순간에 어떤 음악을 듣나요?"],
  "독서·글쓰기": ["책을 고르는 나만의 기준이 있나요?", "요즘 기록하고 있는 것이 있나요?"],
  "자기계발·공부": ["최근에 '이건 배워두길 잘했다' 싶은 것은?", "작은 목표를 꾸준히 지키는 방법이 있나요?"],
  "전시·공연·아트": ["좋아하는 작가나 아티스트가 있나요?", "직접 만들어 본 작품이 있나요?"],
  "패션·뷰티": ["스타일이 크게 바뀐 계기가 있었나요?", "요즘 눈여겨보는 브랜드가 있나요?"],
  "사진·영상": ["사진으로 남기고 싶은 순간은 주로 언제예요?", "휴대폰 앨범에 가장 많은 사진 종류는?"],
};
const GENERIC = ["어렸을 때 꿈은 무엇이었나요?", "주말을 가장 완벽하게 보내는 방법은?", "요즘 가장 자주 하는 생각은?",
  "최근에 새로 시작한 일이 있나요?", "스트레스를 푸는 나만의 방법은?"];

export function templateTopics(interests: string[], used: string[], n = 3): string[] {
  const pool = [...interests.flatMap((i) => FALLBACK[i] ?? []), ...GENERIC].filter((q) => !used.some((u) => u.includes(q)));
  return pool.sort(() => Math.random() - 0.5).slice(0, n);
}

export async function geminiTopics(interests: string[], eCount: number, size: number): Promise<string[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt = [
    `처음 만나는 ${size}명이 저녁 식사 자리에서 나눌 대화 주제 3개를 추천해 줘.`,
    interests.length ? `여러 명의 공통 관심사: ${interests.join(", ")}.` : "공통 관심사는 아직 몰라.",
    `외향(E) ${eCount}명, 내향(I) ${size - eCount}명이야. 내향인도 부담 없이 답할 수 있게.`,
    "조건: 각 주제는 한 문장 질문, 30자 안팎, 사생활(연애·연봉·정치·종교) 금지, 존댓말.",
    "출력: 질문 3줄만, 번호나 기호 없이.",
  ].join("\n");
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9 } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const lines = text.split("\n").map((l) => l.replace(/^[\s\-*·\d.)]+/, "").trim()).filter((l) => l.length > 4);
    return lines.length >= 2 ? lines.slice(0, 3) : null;
  } catch {
    return null;
  }
}

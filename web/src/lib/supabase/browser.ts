import { createBrowserClient } from "@supabase/ssr";

// 브라우저용 (단체방 실시간 수신·메시지 전송). 로그인 쿠키를 그대로 써서 RLS가 적용된다.
export function createBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

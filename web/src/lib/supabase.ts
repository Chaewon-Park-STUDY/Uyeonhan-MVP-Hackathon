import { createClient } from "@supabase/supabase-js";

// 공개 키(anon/publishable)만 사용. RLS가 허용한 데이터만 읽을 수 있다.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
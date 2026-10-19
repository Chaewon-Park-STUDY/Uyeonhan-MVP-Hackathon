-- =====================================================================
-- 0003: 매칭 마감 시각 자동 실행 (PRD MAT-01)
-- 매시간 /api/match 호출 → 엔진이 "마감이 지났고 아직 안 돌린 날짜"가 있을 때만 실행
-- 실행 전 아래 두 값을 바꿀 것:
--   <VERCEL_URL>    예) https://uyeonhan-mvp-hackathon.vercel.app
--   <MATCH_SECRET>  Vercel 환경변수 MATCH_SECRET 과 같은 값
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'auto-match';

select cron.schedule(
  'auto-match',
  '5 * * * *',                       -- 매시 5분 (화요일 24:00 마감 → 수요일 00:05 실행)
  $$
  select net.http_post(
    url     := '<VERCEL_URL>/api/match',
    headers := jsonb_build_object('Authorization', 'Bearer <MATCH_SECRET>', 'Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

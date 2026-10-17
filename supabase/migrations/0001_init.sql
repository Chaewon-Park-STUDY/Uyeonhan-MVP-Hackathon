-- =====================================================================
-- 우연한 식탁 MVP — 초기 스키마
-- 원칙
--   1) 신청 / 결제 / 매칭 / 참석 상태는 각각 별도 컬럼 (PRD 12장)
--   2) 정책값(가중치, 최소점수, 환불 구간, 노쇼 제재, 쿠폰)은 코드가 아니라 settings 테이블
--   3) 같은 작업 재실행 시 중복 테이블·환불·단체방이 생기지 않도록 UNIQUE 제약 (멱등성)
--   4) 필수 조건(인원 4~6, 나이차 8살, 차단·비선호)은 테이블 확정 시 DB 트리거가 재검증
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------
create type user_role          as enum ('participant', 'admin');
create type gender_t           as enum ('M', 'F');
create type application_status as enum ('DRAFT', 'SUBMITTED', 'CANCELED');
create type payment_status     as enum ('PENDING', 'PAID', 'FAILED', 'REFUND_AVAILABLE',
                                        'REFUND_REQUESTED', 'REFUND_PROCESSING', 'REFUNDED', 'REFUND_FAILED');
create type match_status       as enum ('WAITING', 'MATCHING', 'REALLOCATING', 'CONFIRMED',
                                        'ALTERNATIVE_OFFERED', 'TRANSFERRED', 'NO_MATCH', 'EXCEPTION');
create type attendance_status  as enum ('SCHEDULED', 'ATTENDED', 'CANCELED_EARLY', 'CANCELED_LATE', 'NO_SHOW');
create type fail_preference    as enum ('MOVE_DATE', 'MOVE_REGION', 'KEEP_PASS', 'REFUND');  -- 매칭 실패 시 사전 선택 (멤버십은 REFUND 대신 기간 연장)
create type table_status       as enum ('DRAFT', 'CONFIRMED', 'DISSOLVED', 'CANCELED');
create type pass_type          as enum ('SINGLE', 'MEMBERSHIP_1M', 'MEMBERSHIP_3M', 'MEMBERSHIP_6M');
create type coupon_kind        as enum ('REVISIT', 'REFERRAL_NEW', 'REFERRAL_INVITER');
create type person_pref_kind   as enum ('LIKE', 'AVOID');
create type exception_kind     as enum ('PAYMENT', 'DATA', 'VENUE', 'CONFLICT', 'NOTIFY', 'REFUND', 'SAFETY');
create type case_status        as enum ('OPEN', 'RESOLVED');

-- ---------------------------------------------------------------------
-- 사용자 / 프로필
-- ---------------------------------------------------------------------
create table profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             user_role not null default 'participant',
  name             text not null,
  phone            text,
  birth_year       int  not null check (birth_year between 1940 and 2010),
  gender           gender_t not null,
  job              text,
  mbti             char(4) check (mbti ~ '^[EI][SN][TF][JP]$'),          -- 대문자 정규화 후 저장
  interests        text[] not null default '{}',                          -- 관심사
  self_traits      text[] not null default '{}',                          -- 나는 어떤 사람
  desired_traits   text[] not null default '{}',                          -- 만나고 싶은 사람
  allergies        text[] not null default '{}',                          -- 알레르기: 식당 배정 시 필수 제외
  food_dislikes    text[] not null default '{}',                          -- 비선호: 식당 배정 시 감점
  budget_ranges    text[] not null default '{}',
  default_fail_pref fail_preference not null default 'MOVE_DATE',
  referral_code    text unique not null default substr(encode(gen_random_bytes(6), 'hex'), 1, 8),
  referred_by      uuid references profiles(id),
  restricted_until timestamptz,                                            -- 노쇼 제재
  privacy_agreed_at timestamptz,                                           -- ACC-05
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 지역 / 회차 / 식당
-- ---------------------------------------------------------------------
create table regions (
  code text primary key,           -- 'HONGDAE', 'GANGNAM', 'EULJIRO', 'JAMSIL'
  name text not null
);

create table event_slots (
  id              uuid primary key default gen_random_uuid(),
  region_code     text not null references regions(code),
  starts_at       timestamptz not null,
  capacity        int not null default 30,
  apply_deadline  timestamptz not null,
  match_run_at    timestamptz not null,       -- 자동 매칭 실행 시각 (MAT-01)
  is_open         boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (region_code, starts_at)
);

create table venues (
  id           uuid primary key default gen_random_uuid(),
  region_code  text not null references regions(code),
  name         text not null,
  address      text not null,
  map_url      text,
  price_range  text,
  rating       numeric(2,1),                     -- 리뷰 평점: 식당 배정 시 우선순위
  is_reservable boolean not null default true,
  menu_tags    text[] not null default '{}',     -- '해산물','날것','내장류','매운음식','견과류' 등
  is_active    boolean not null default true
);

create table venue_availability (               -- 회차별 수용 가능 테이블 수
  venue_id      uuid references venues(id) on delete cascade,
  slot_id       uuid references event_slots(id) on delete cascade,
  tables_total  int not null default 1,
  tables_used   int not null default 0 check (tables_used <= tables_total),
  primary key (venue_id, slot_id)
);

-- ---------------------------------------------------------------------
-- 이용권 / 쿠폰
-- ---------------------------------------------------------------------
create table passes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id),
  type        pass_type not null,
  remaining   int check (remaining >= 0),        -- 1회권: 1 → 0, 멤버십: null (기간 내 무제한)
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz,                       -- 멤버십 만료일
  extended_days int not null default 0,          -- 매칭 실패로 연장된 일수 (실패 1회 = 7일)
  created_at  timestamptz not null default now()
);

create table coupons (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id),
  kind           coupon_kind not null,
  discount_rate  numeric(4,3) not null check (discount_rate > 0 and discount_rate <= 1),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  source_ref     uuid,                         -- 지급 근거 (feedback id, 추천받은 user id 등)
  created_at     timestamptz not null default now(),
  unique (user_id, kind, source_ref)           -- 같은 근거로 중복 지급 방지
);

-- ---------------------------------------------------------------------
-- 신청 (상태 4종 분리)
-- ---------------------------------------------------------------------
create table applications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id),
  pass_id             uuid references passes(id),
  coupon_id           uuid unique references coupons(id),   -- 쿠폰 1장 = 결제 1건
  fail_pref           fail_preference not null,             -- 신청 시 미리 받은 실패 선택지
  application_status  application_status not null default 'DRAFT',
  payment_status      payment_status     not null default 'PENDING',
  match_status        match_status       not null default 'WAITING',
  assigned_slot_id    uuid references event_slots(id),      -- 최종 배정 회차
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table application_slots (                -- 참가 가능 날짜·지역 복수 선택 (APP-02)
  application_id uuid references applications(id) on delete cascade,
  slot_id        uuid references event_slots(id),
  primary key (application_id, slot_id)
);

create table payments (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null references applications(id),
  amount           int not null,
  discount_amount  int not null default 0,
  method           text not null default 'MOCK',
  status           payment_status not null,
  refund_rate      numeric(4,3),
  refund_amount    int,
  idempotency_key  text unique not null,           -- 중복 승인·중복 환불 방지
  created_at       timestamptz not null default now(),
  refunded_at      timestamptz
);

-- ---------------------------------------------------------------------
-- 매칭
-- ---------------------------------------------------------------------
create table match_runs (
  id                 uuid primary key default gen_random_uuid(),
  run_key            text unique not null,          -- 예: '2026-10-22' → 같은 날짜 매칭 중복 실행 방지
  algorithm_version  text not null,
  params             jsonb not null,                -- 실행 당시 가중치·최소점수 스냅샷
  stats              jsonb,                         -- 후보 수, 생성/분리/병합/재배치/확정/실패 수
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  error              text
);

create table dining_tables (
  id               uuid primary key default gen_random_uuid(),
  slot_id          uuid not null references event_slots(id),
  match_run_id     uuid references match_runs(id),
  status           table_status not null default 'DRAFT',
  score            numeric(5,4),
  score_breakdown  jsonb,              -- {gender, mbti, interest, desired, novelty}
  explanation      jsonb,              -- 참가자에게 보여줄 매칭 근거 (개인정보·상세점수 제외)
  venue_id         uuid references venues(id),
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now()
);

create table table_members (
  table_id            uuid references dining_tables(id) on delete cascade,
  application_id      uuid unique references applications(id),   -- 한 신청은 한 테이블에만 (동시 배치 금지)
  user_id             uuid not null references profiles(id),
  reallocation_count  int not null default 0,
  placement_reason    text,
  attendance          attendance_status not null default 'SCHEDULED',
  canceled_at         timestamptz,
  checked_in_at       timestamptz,
  primary key (table_id, user_id)
);

create table match_resolutions (                -- 매칭 실패 해결 (STA-04~06)
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid unique not null references applications(id),
  offered_slots    uuid[] not null default '{}',
  choice           fail_preference,
  chosen_slot_id   uuid references event_slots(id),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 단체방 / 알림
-- ---------------------------------------------------------------------
create table chat_rooms (
  id        uuid primary key default gen_random_uuid(),
  table_id  uuid unique not null references dining_tables(id),   -- 테이블당 1개 (중복 생성 방지)
  created_at timestamptz not null default now()
);

create table chat_messages (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references chat_rooms(id) on delete cascade,
  sender_id  uuid references profiles(id),       -- null = 시스템 메시지
  kind       text not null default 'USER',        -- USER | NOTICE | CURATION | TOPIC | REMINDER
  content    text not null,
  created_at timestamptz not null default now()
);

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id),
  template      text not null,
  payload       jsonb not null default '{}',
  scheduled_at  timestamptz not null default now(),
  sent_at       timestamptz,
  attempts      int not null default 0,
  last_error    text,
  dedupe_key    text unique not null              -- 같은 안내 중복 발송 방지
);

-- ---------------------------------------------------------------------
-- 피드백 / 안전
-- ---------------------------------------------------------------------
create table feedback (
  id              uuid primary key default gen_random_uuid(),
  table_id        uuid not null references dining_tables(id),
  user_id         uuid not null references profiles(id),
  table_score     int check (table_score between 1 and 5),
  convo_score     int check (convo_score between 1 and 5),
  venue_score     int check (venue_score between 1 and 5),
  revisit_intent  int check (revisit_intent between 1 and 5),
  recommend_intent int check (recommend_intent between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now(),
  unique (table_id, user_id)
);

create table person_preferences (               -- 다시 만나고 싶은/싫은 사람 (비공개)
  from_user  uuid references profiles(id),
  to_user    uuid references profiles(id),
  kind       person_pref_kind not null,
  table_id   uuid references dining_tables(id),
  created_at timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);

create table safety_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references profiles(id),
  reported_id  uuid not null references profiles(id),
  table_id     uuid references dining_tables(id),
  reason       text not null,
  status       case_status not null default 'OPEN',
  admin_action text,                               -- WARNING | RESTRICTED | BANNED
  created_at   timestamptz not null default now()
);

create table blocks (
  blocker_id uuid references profiles(id),
  blocked_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- ---------------------------------------------------------------------
-- 운영: 설정 / 예외 / 감사 로그
-- ---------------------------------------------------------------------
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table exception_cases (
  id             uuid primary key default gen_random_uuid(),
  kind           exception_kind not null,
  application_id uuid references applications(id),
  table_id       uuid references dining_tables(id),
  reason         text not null,
  status         case_status not null default 'OPEN',
  admin_note     text,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create table audit_log (
  id         bigint generated always as identity primary key,
  entity     text not null,
  entity_id  uuid not null,
  field      text not null,
  old_value  text,
  new_value  text,
  actor      text not null,            -- 'system:matcher', 'admin:<uuid>', 'user:<uuid>'
  reason     text,
  at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 파생: 이미 만난 쌍 (참석 완료 기준) — 새로운 사람 점수·제외에 사용
-- ---------------------------------------------------------------------
create view met_pairs as
select distinct least(a.user_id, b.user_id) as u1, greatest(a.user_id, b.user_id) as u2
from table_members a
join table_members b on a.table_id = b.table_id and a.user_id < b.user_id
where a.attendance = 'ATTENDED' and b.attendance = 'ATTENDED';

-- 같은 테이블에 둘 수 없는 쌍 (차단 + 신고 + 비선호, 방향 무관)
create view excluded_pairs as
select least(blocker_id, blocked_id) as u1, greatest(blocker_id, blocked_id) as u2 from blocks
union
select least(reporter_id, reported_id), greatest(reporter_id, reported_id) from safety_reports
union
select least(from_user, to_user), greatest(from_user, to_user) from person_preferences where kind = 'AVOID';

-- ---------------------------------------------------------------------
-- 안전장치: 테이블 확정 시 필수 조건 재검증 (MAT-07)
-- ---------------------------------------------------------------------
create or replace function validate_table_on_confirm() returns trigger
language plpgsql as $$
declare
  n int; age_gap int; conflicts int; max_gap int;
begin
  if new.status = 'CONFIRMED' and (old.status is distinct from 'CONFIRMED') then
    max_gap := coalesce((select (value->>'max_age_gap')::int from settings where key = 'matching'), 8);

    select count(*), max(p.birth_year) - min(p.birth_year)
      into n, age_gap
      from table_members m join profiles p on p.id = m.user_id
     where m.table_id = new.id;

    if n < 4 or n > 6 then
      raise exception 'TABLE_SIZE_INVALID: % members', n;
    end if;
    if age_gap > max_gap then
      raise exception 'AGE_GAP_EXCEEDED: % years', age_gap;
    end if;

    select count(*) into conflicts
      from table_members a
      join table_members b on a.table_id = b.table_id and a.user_id < b.user_id
      join excluded_pairs x on x.u1 = a.user_id and x.u2 = b.user_id
     where a.table_id = new.id;
    if conflicts > 0 then
      raise exception 'EXCLUDED_PAIR_PRESENT: % pairs', conflicts;
    end if;

    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  return new;
end $$;

create trigger trg_validate_table_confirm
before update of status on dining_tables
for each row execute function validate_table_on_confirm();

-- 상태 변경 감사 로그 (applications)
create or replace function log_application_status() returns trigger
language plpgsql as $$
declare actor text := coalesce(current_setting('app.actor', true), 'unknown');
begin
  if new.application_status is distinct from old.application_status then
    insert into audit_log(entity, entity_id, field, old_value, new_value, actor)
    values ('application', new.id, 'application_status', old.application_status, new.application_status, actor);
  end if;
  if new.payment_status is distinct from old.payment_status then
    insert into audit_log(entity, entity_id, field, old_value, new_value, actor)
    values ('application', new.id, 'payment_status', old.payment_status, new.payment_status, actor);
  end if;
  if new.match_status is distinct from old.match_status then
    insert into audit_log(entity, entity_id, field, old_value, new_value, actor)
    values ('application', new.id, 'match_status', old.match_status, new.match_status, actor);
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger trg_log_application_status
before update on applications
for each row execute function log_application_status();

-- ---------------------------------------------------------------------
-- RLS: 본인 데이터만, 운영자는 전체
-- ---------------------------------------------------------------------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

alter table profiles           enable row level security;
alter table applications       enable row level security;
alter table application_slots  enable row level security;
alter table payments           enable row level security;
alter table coupons            enable row level security;
alter table passes             enable row level security;
alter table feedback           enable row level security;
alter table person_preferences enable row level security;
alter table safety_reports     enable row level security;
alter table blocks             enable row level security;
alter table match_resolutions  enable row level security;
alter table notifications      enable row level security;
alter table chat_rooms         enable row level security;
alter table chat_messages      enable row level security;
alter table table_members      enable row level security;
alter table dining_tables      enable row level security;

create policy own_profile      on profiles           for all using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());
create policy own_app          on applications       for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());
create policy own_app_slots    on application_slots  for all using (exists (select 1 from applications a where a.id = application_id and (a.user_id = auth.uid() or is_admin())));
create policy own_payments     on payments           for select using (exists (select 1 from applications a where a.id = application_id and (a.user_id = auth.uid() or is_admin())));
create policy own_coupons      on coupons            for select using (user_id = auth.uid() or is_admin());
create policy own_passes       on passes             for select using (user_id = auth.uid() or is_admin());
create policy own_feedback     on feedback           for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());
create policy own_prefs        on person_preferences for all using (from_user = auth.uid() or is_admin()) with check (from_user = auth.uid());   -- 상대에게 비공개
create policy own_reports      on safety_reports     for all using (reporter_id = auth.uid() or is_admin()) with check (reporter_id = auth.uid());
create policy own_blocks       on blocks             for all using (blocker_id = auth.uid() or is_admin()) with check (blocker_id = auth.uid());
create policy own_resolution   on match_resolutions  for all using (exists (select 1 from applications a where a.id = application_id and (a.user_id = auth.uid() or is_admin())));
create policy own_noti         on notifications      for select using (user_id = auth.uid() or is_admin());

-- 같은 테이블 멤버만 테이블·멤버·단체방 열람 (확정 후)
create or replace function is_table_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from table_members where table_id = t and user_id = auth.uid());
$$;

create policy member_tables   on dining_tables  for select using (is_admin() or (status = 'CONFIRMED' and is_table_member(id)));
create policy member_members  on table_members  for select using (is_admin() or is_table_member(table_id));
create policy member_rooms    on chat_rooms     for select using (is_admin() or is_table_member(table_id));
create policy member_msgs_r   on chat_messages  for select using (is_admin() or exists (select 1 from chat_rooms r where r.id = room_id and is_table_member(r.table_id)));
create policy member_msgs_w   on chat_messages  for insert with check (sender_id = auth.uid() and exists (select 1 from chat_rooms r where r.id = room_id and is_table_member(r.table_id)));

-- 공개 읽기: 지역·회차·식당 (참가자 회차 목록용)
alter table regions     enable row level security;
alter table event_slots enable row level security;
alter table venues      enable row level security;
create policy read_regions on regions     for select using (true);
create policy read_slots   on event_slots for select using (true);
create policy read_venues  on venues      for select using (true);
-- 매칭 엔진(Python)은 service_role 키로 접속 → RLS 우회

-- ---------------------------------------------------------------------
-- 기본 데이터: 지역 + 정책 설정
-- ---------------------------------------------------------------------
insert into regions(code, name) values
  ('HONGDAE', '홍대/합정'), ('GANGNAM', '강남/신논현'), ('EULJIRO', '을지로/종로'), ('JAMSIL', '잠실');

insert into settings(key, value) values
('matching', '{
   "weights": {"gender": 0.30, "mbti": 0.25, "interest": 0.20, "desired": 0.15, "novelty": 0.10},
   "min_score": 0.45,
   "table_size": {"min": 4, "max": 6},
   "max_age_gap": 8,
   "gender_rule": {"single_minority_score": 0.0, "same_gender_score": 0.3}
 }'),
('refund_policy', '{
   "cutoff": "TUESDAY_24_00_KST",
   "tiers": [
     {"until_cutoff": true, "rate": 1.0},
     {"after_cutoff": true, "rate": 0.0}
   ],
   "match_failure_rate": 1.0,
   "no_show_rate": 0.0,
   "same_day_cancel": "ALLOWED_NO_REFUND"
 }'),
('no_show_sanction', '{"no_show_point": 1.0, "late_cancel_point": 0.5, "threshold": 2.0, "restrict_days": 30, "window_days": 90}'),
('coupons', '{
   "revisit":  {"rate": 0.10, "valid_days": 14, "trigger": "FEEDBACK_SUBMITTED"},
   "referral": {"new_user_rate": 0.10, "inviter_rate": 0.10, "valid_days": 30, "inviter_trigger": "FRIEND_ATTENDED"},
   "max_per_payment": 1
 }'),
('pricing', '{
   "SINGLE":        {"price": 9900},
   "MEMBERSHIP_1M": {"price": 35000,  "months": 1},
   "MEMBERSHIP_3M": {"price": 75000,  "months": 3},
   "MEMBERSHIP_6M": {"price": 120000, "months": 6},
   "membership_fail_extension_days": 7
 }');

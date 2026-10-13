-- Parchi schema. Idempotent: safe to run more than once.
-- Supabase: run `npm run db:migrate` with DATABASE_URL set (or paste into the SQL editor).
-- Local dev: applied automatically to the PGlite database in .data/pglite.
--
-- Access model: every read and write goes through Next.js server routes that connect as the
-- database owner. Browsers never talk to this database directly. RLS is enabled with NO policies,
-- and anon/authenticated grants are revoked (Supabase only), so the public Data API cannot read
-- or write these tables even with the publishable key.

create table if not exists encounters (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  alias text not null,
  patient_name text not null,
  patient_age int,
  patient_ref text,
  language text not null default 'hi' check (language in ('hi','en')),
  voice_consent boolean,
  mode text not null default 'live' check (mode in ('live','replay','manual')),
  status text not null default 'intake' check (status in ('intake','paused_urgent','ready')),
  intake_started_at timestamptz,
  intake_completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Source files (page photos, answer clips). Private: served only through authenticated routes.
create table if not exists blobs (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id),
  mime text not null,
  size_bytes int not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id),
  kind text not null check (kind in ('page','clip','typed')),
  seq int not null,
  label text not null,
  blob_id uuid references blobs(id),
  mime text,
  sha256 text,
  status text not null default 'uploaded' check (status in ('uploaded','processing','done','failed')),
  processing_started_at timestamptz,
  error text,
  readability text not null default 'unknown' check (readability in ('unknown','readable','partial','unreadable')),
  identity text not null default 'unchecked' check (identity in ('unchecked','matched','mismatch','confirmed_patient','withheld')),
  mode text not null default 'live' check (mode in ('live','replay','manual')),
  model text,
  timings jsonb,
  ocr jsonb,
  doc_type text check (doc_type in ('prescription','lab_report','history_note','other')),
  clinic text,
  doc_date jsonb,
  name_on_doc text,
  age_on_doc text,
  id_on_doc text,
  width int,
  height int,
  question_id uuid,
  typed_text text,
  transcript_hi text,
  transcript_en text,
  translation_by text check (translation_by in ('sarvam','claude')),
  duration_ms int,
  supersedes_id uuid references sources(id),
  created_at timestamptz not null default now(),
  unique (encounter_id, seq)
);
alter table sources add column if not exists processing_started_at timestamptz;
-- Same file uploaded twice in one encounter = same source (retries never duplicate facts).
create unique index if not exists sources_encounter_sha_uniq on sources (encounter_id, sha256) where sha256 is not null;

create table if not exists facts (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id),
  source_id uuid not null references sources(id),
  group_key text,
  kind text not null,
  value text not null,
  value_en text,
  quote text,
  anchor jsonb,
  evidence text not null check (evidence in ('box','page','clip','text')),
  check_state text not null check (check_state in ('source_matched','pending_check','nurse_confirmed','nurse_corrected','unreadable')),
  reasons text[] not null default '{}',
  subject text not null default 'patient' check (subject in ('patient','other_person','unknown')),
  assertion text not null default 'present' check (assertion in ('present','denied','uncertain')),
  temporality text not null default 'unknown' check (temporality in ('current','historical','unknown')),
  supersedes_id uuid references facts(id),
  superseded_by uuid references facts(id),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists facts_current_idx on facts (encounter_id) where superseded_by is null;
-- At most one successor per fact revision: the database itself rejects a second concurrent correction.
create unique index if not exists facts_supersedes_uniq on facts (supersedes_id) where supersedes_id is not null;

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id),
  candidate_id text not null,
  reason text not null,
  fact_ids text[] not null default '{}',
  state text not null default 'asked' check (state in ('asked','answered','unknown','skipped')),
  answer_source_id uuid references sources(id),
  picked_by text not null check (picked_by in ('claude','priority')),
  created_at timestamptz not null default now(),
  unique (encounter_id, candidate_id)
);

-- Append-only audit log.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id),
  actor text not null,
  role text not null check (role in ('nurse','doctor','patient','system')),
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists events_encounter_idx on events (encounter_id, created_at);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id),
  trigger text not null check (trigger in ('manual','words')),
  quote text,
  source_id uuid references sources(id),
  requested_at timestamptz not null default now(),
  delivered_at timestamptz,
  acked_at timestamptz,
  acked_by text,
  resumed_at timestamptz,
  resumed_by text
);
-- One open (not yet resumed) alert per encounter: repeated help presses are idempotent.
create unique index if not exists alerts_one_open_per_encounter on alerts (encounter_id) where resumed_at is null;

-- Recorded provider outputs for REPLAY mode, keyed by the exact file hash.
create table if not exists replays (
  sha256 text primary key,
  kind text not null,
  result jsonb not null,
  model text,
  recorded_at timestamptz not null default now()
);

alter table encounters enable row level security;
alter table blobs enable row level security;
alter table sources enable row level security;
alter table facts enable row level security;
alter table questions enable row level security;
alter table events enable row level security;
alter table alerts enable row level security;
alter table replays enable row level security;

-- Supabase-only hardening. The roles do not exist in local PGlite, so this block is skipped there.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table encounters, blobs, sources, facts, questions, events, alerts, replays from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
  end if;
end $$;

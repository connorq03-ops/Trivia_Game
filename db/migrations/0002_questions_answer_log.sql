create table if not exists questions (
  id text primary key,
  fact_id text not null,
  side text not null check (side in ('rules', 'players')),
  sport text not null check (sport in ('football', 'basketball', 'baseball')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists answer_log (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  mode text not null check (mode in ('classic', 'daily')),
  question_id text not null references questions(id),
  question_index int not null,
  answer_ms int,
  correct boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists answer_log_question_id_idx
  on answer_log (question_id);

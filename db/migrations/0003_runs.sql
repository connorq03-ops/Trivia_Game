create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('classic', 'daily')),
  sport text not null default 'all'
    check (sport in ('all', 'football', 'basketball', 'baseball')),
  side text not null default 'both'
    check (side in ('both', 'rules', 'players')),
  daily_date date,
  status text not null default 'active' check (status in ('active', 'ended')),
  end_reason text check (end_reason in ('strikes', 'bank', 'complete')),
  progress jsonb not null,
  used_fact_ids text[] not null default '{}',
  question_index int not null default 0,
  current_question_id text,
  current_choices text[],
  issued_at timestamptz,
  last_response jsonb,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists runs_ip_hash_created_at_idx
  on runs (ip_hash, created_at);

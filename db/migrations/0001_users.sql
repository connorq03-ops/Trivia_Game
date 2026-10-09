create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create unique index users_email_lower_idx on users (lower(email));

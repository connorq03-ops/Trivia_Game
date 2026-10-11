-- Only the creator of a run holds its token; the server stores just its hash.
alter table runs add column if not exists token_hash text;

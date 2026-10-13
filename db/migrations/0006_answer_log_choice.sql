-- Store the selected choice and answer result for each answer.
alter table answer_log add column if not exists choice text;
alter table answer_log add column if not exists result text
  check (result in ('hit', 'miss', 'timeout'));

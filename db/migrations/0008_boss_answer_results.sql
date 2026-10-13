-- Boss answers log boss-tagged results; extend the allowed set.
alter table answer_log drop constraint if exists answer_log_result_check;
alter table answer_log add constraint answer_log_result_check
  check (result in ('hit', 'miss', 'timeout', 'boss-hit', 'boss-miss', 'boss-timeout'));

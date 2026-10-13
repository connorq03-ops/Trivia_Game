-- Adds the expert tier above hard.
alter table questions drop constraint if exists questions_difficulty_check;
alter table questions add constraint questions_difficulty_check
  check (difficulty in ('easy', 'medium', 'hard', 'expert'));

-- Boss questions (non-sports, Classic only) are stored with side and sport 'boss'.
alter table questions drop constraint if exists questions_side_check;
alter table questions add constraint questions_side_check
  check (side in ('rules', 'players', 'boss'));
alter table questions drop constraint if exists questions_sport_check;
alter table questions add constraint questions_sport_check
  check (sport in ('football', 'basketball', 'baseball', 'boss'));

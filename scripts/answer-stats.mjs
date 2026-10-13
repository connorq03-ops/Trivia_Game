// Read-only answer report: npm run stats:answers -- [--since=YYYY-MM-DD] [--min=3]
import 'dotenv/config'
import pg from 'pg'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => arg.slice(2).split('=', 2)),
)
const since = args.since ?? null
const minAttempts = Number(args.min ?? 3)
if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since must be YYYY-MM-DD')
  process.exit(1)
}
if (!Number.isInteger(minAttempts) || minAttempts < 1) {
  console.error('--min must be a positive integer')
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL must be set.')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

const scope = `
  with scoped as (
    select a.*, r.ip_hash
    from answer_log a
    left join runs r on r.id = a.run_id
    where $1::date is null or a.created_at >= $1::date
  )`

async function section(title, query, params = [since]) {
  const { rows } = await client.query(scope + query, params)
  console.log(`\n## ${title}`)
  if (rows.length === 0) console.log('(none)')
  else console.table(rows)
}

try {
  await client.query('begin read only')
  console.log(`Answer stats${since ? ` since ${since}` : ''} (min ${minAttempts} attempts per question)`)

  await section(
    'Overview',
    `
    select
      count(*)::int as answers,
      count(distinct run_id)::int as runs,
      count(distinct ip_hash)::int as players,
      round(100.0 * avg(correct::int))::int as correct_pct,
      count(distinct question_id)::int as questions_seen,
      (select count(*)::int from questions) as bank,
      count(result)::int as answers_with_pick_logged,
      min(created_at) as first,
      max(created_at) as last
    from scoped`,
  )

  await section(
    'By difficulty',
    `
    select
      q.difficulty,
      count(*)::int as answers,
      round(100.0 * avg(s.correct::int))::int as correct_pct,
      round(100.0 * count(*) filter (where s.result = 'timeout')
        / nullif(count(s.result), 0))::int as timeout_pct,
      round(avg(s.answer_ms) filter (where s.correct))::int as avg_correct_ms
    from scoped s
    join questions q on q.id = s.question_id
    group by q.difficulty
    order by array_position(array['easy', 'medium', 'hard', 'expert'], q.difficulty)`,
  )

  const perQuestion = `
    , per_question as (
      select
        s.question_id,
        count(*)::int as answers,
        round(100.0 * avg(s.correct::int))::int as correct_pct,
        round(100.0 * count(*) filter (where s.result = 'timeout')
          / nullif(count(s.result), 0))::int as timeout_pct,
        round(avg(s.answer_ms) filter (where s.correct))::int as avg_correct_ms
      from scoped s
      group by s.question_id
      having count(*) >= $2
    ),
    wrong_picks as (
      select question_id, choice, count(*)::int as picks,
        row_number() over (
          partition by question_id order by count(*) desc, choice
        ) as rank
      from scoped
      where result = 'miss'
      group by question_id, choice
    )
    select
      p.question_id,
      q.difficulty,
      left(q.data->>'prompt', 60) as prompt,
      p.answers,
      p.correct_pct,
      p.timeout_pct,
      p.avg_correct_ms,
      w.choice as top_wrong_pick,
      w.picks as top_wrong_picks
    from per_question p
    join questions q on q.id = p.question_id
    left join wrong_picks w on w.question_id = p.question_id and w.rank = 1`

  await section(
    'Hardest questions (lowest correct %)',
    `${perQuestion} order by p.correct_pct, p.answers desc, p.question_id limit 25`,
    [since, minAttempts],
  )

  await section(
    'Tier check (easy/medium under 50% correct, hard/expert at 90%+)',
    `${perQuestion}
    where (q.difficulty in ('easy', 'medium') and p.correct_pct < 50)
       or (q.difficulty in ('hard', 'expert') and p.correct_pct >= 90)
    order by q.difficulty, p.correct_pct, p.question_id`,
    [since, minAttempts],
  )

  await client.query('rollback')
} finally {
  await client.end()
}

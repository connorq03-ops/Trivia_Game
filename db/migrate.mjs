import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import pg from 'pg'

const { Client } = pg
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
)

async function migrate() {
  const connectionString =
    process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL_DIRECT or DATABASE_URL must be set.')
  }

  const client = new Client({ connectionString })

  try {
    await client.connect()
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const { rows } = await client.query(
      'select filename from schema_migrations',
    )
    const applied = new Set(rows.map(({ filename }) => filename))
    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort()

    for (const filename of filenames) {
      if (applied.has(filename)) {
        console.log(`Skipped ${filename}`)
        continue
      }

      const migration = await readFile(
        join(migrationsDirectory, filename),
        'utf8',
      )
      await client.query('begin')
      try {
        await client.query(migration)
        await client.query(
          'insert into schema_migrations (filename) values ($1)',
          [filename],
        )
        await client.query('commit')
        console.log(`Applied ${filename}`)
      } catch {
        await client.query('rollback')
        throw new Error('Migration failed.')
      }
    }
  } finally {
    await client.end()
  }
}

migrate().catch(() => {
  console.error('Migration failed.')
  process.exitCode = 1
})

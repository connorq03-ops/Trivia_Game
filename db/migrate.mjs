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
// Shared by all migration processes to serialize schema changes.
const LOCK_KEY = 727001

function getErrorMessage(error, connectionString) {
  const message = error instanceof Error ? error.message : String(error)
  return message.split(connectionString).join('[redacted]')
}

async function migrate() {
  const connectionString =
    process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
  if (!connectionString) {
    console.error(
      'Migration failed: connection: DATABASE_URL_DIRECT or DATABASE_URL must be set.',
    )
    process.exitCode = 1
    return
  }

  let client
  let context = 'connection'
  let transactionOpen = false

  try {
    client = new Client({ connectionString })
    await client.connect()
    context = 'schema_migrations'
    await client.query('begin')
    transactionOpen = true
    await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY])
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `)
    await client.query('commit')
    transactionOpen = false
    context = 'migrations'
    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort()

    for (const filename of filenames) {
      context = filename
      await client.query('begin')
      transactionOpen = true
      await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY])
      const { rows } = await client.query(
        'select 1 from schema_migrations where filename = $1',
        [filename],
      )
      if (rows.length > 0) {
        await client.query('commit')
        transactionOpen = false
        console.log(`Skipped ${filename}`)
        continue
      }

      const migration = await readFile(
        join(migrationsDirectory, filename),
        'utf8',
      )
      await client.query(migration)
      await client.query(
        'insert into schema_migrations (filename) values ($1)',
        [filename],
      )
      await client.query('commit')
      transactionOpen = false
      console.log(`Applied ${filename}`)
    }
  } catch (error) {
    if (transactionOpen) {
      await client.query('rollback').catch(() => {})
    }
    console.error(
      `Migration failed: ${context}: ${getErrorMessage(error, connectionString)}`,
    )
    process.exitCode = 1
  }

  if (client) {
    try {
      await client.end()
    } catch (error) {
      if (process.exitCode !== 1) {
        console.error(
          `Migration failed: connection: ${getErrorMessage(error, connectionString)}`,
        )
        process.exitCode = 1
      }
    }
  }
}

migrate()

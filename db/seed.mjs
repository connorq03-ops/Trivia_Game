import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import pg from 'pg'

const { Client } = pg
const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)))

function getErrorMessage(error, connectionString) {
  const message = error instanceof Error ? error.message : String(error)
  return message.split(connectionString).join('[redacted]')
}

async function seed() {
  const connectionString =
    process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('Seed failed: DATABASE_URL_DIRECT or DATABASE_URL must be set.')
    process.exitCode = 1
    return
  }

  let client
  let transactionOpen = false

  try {
    const [rules, players] = await Promise.all(
      ['rules.json', 'players.json'].map(async (filename) =>
        JSON.parse(
          await readFile(join(rootDirectory, 'content', filename), 'utf8'),
        ),
      ),
    )
    const questions = [...rules, ...players]
    client = new Client({ connectionString })
    await client.connect()
    await client.query('begin')
    transactionOpen = true

    for (const question of questions) {
      await client.query(
        `
          insert into questions (id, fact_id, side, sport, difficulty, data)
          values ($1, $2, $3, $4, $5, $6::jsonb)
          on conflict (id) do update set
            fact_id = excluded.fact_id,
            side = excluded.side,
            sport = excluded.sport,
            difficulty = excluded.difficulty,
            data = excluded.data,
            updated_at = now()
        `,
        [
          question.id,
          question.factId,
          question.side,
          question.sport,
          question.difficulty,
          JSON.stringify(question),
        ],
      )
    }

    await client.query('commit')
    transactionOpen = false
    console.log(`Seeded ${questions.length} questions`)
  } catch (error) {
    if (transactionOpen) await client.query('rollback').catch(() => {})
    console.error(`Seed failed: ${getErrorMessage(error, connectionString)}`)
    process.exitCode = 1
  }

  if (client) {
    try {
      await client.end()
    } catch (error) {
      if (process.exitCode !== 1) {
        console.error(`Seed failed: ${getErrorMessage(error, connectionString)}`)
        process.exitCode = 1
      }
    }
  }
}

seed()

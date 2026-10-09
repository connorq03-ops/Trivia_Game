import { getSql } from '../lib/db.js'

export async function GET(): Promise<Response> {
  try {
    const sql = getSql()
    await sql`select 1`
    return Response.json({ ok: true, db: true })
  } catch {
    return Response.json({ ok: false, db: false }, { status: 500 })
  }
}

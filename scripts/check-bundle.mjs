import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? filesUnder(path) : [path]
    }),
  )
  return nested.flat()
}

const candidates = []
const contentFiles = (await readdir('content'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => join('content', name))
for (const file of contentFiles) {
  const questions = JSON.parse(await readFile(file, 'utf8'))
  for (const question of questions) {
    for (const field of ['answer', 'teach']) {
      const value = question[field]
      if (typeof value === 'string' && value.length >= 4) {
        candidates.push({
          id: question.id,
          field,
          variants: [value, JSON.stringify(value).slice(1, -1)],
        })
      }
    }
  }
}

const bundleFiles = (await filesUnder('dist')).filter((file) =>
  /\.(?:js|html)$/i.test(file),
)
const leaks = []
for (const file of bundleFiles) {
  const contents = await readFile(file, 'utf8')
  for (const candidate of candidates) {
    if (candidate.variants.some((value) => contents.includes(value))) {
      leaks.push(`${candidate.id} (${candidate.field}) in ${relative('.', file)}`)
    }
  }
}

if (leaks.length > 0) {
  console.error('Answer or teaching content found in the client bundle:')
  for (const leak of leaks) console.error(`- ${leak}`)
  process.exitCode = 1
} else {
  console.log(
    `Checked ${candidates.length} content strings across ${bundleFiles.length} bundle files; no answer or teach text found.`,
  )
}

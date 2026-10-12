// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const RUN_TOKEN = 'x'.repeat(43)

function publicQuestion(index: number) {
  return {
    id: `q${index}`,
    side: 'rules',
    sport: 'football',
    leagues: ['NFL'],
    difficulty: 'easy',
    category: 'Scoring',
    prompt: `Prompt ${index}?`,
    choices: [`A${index}`, `B${index}`, `C${index}`, `D${index}`],
  }
}

type Grade = { correct: boolean; strikes: number; streak: number }

function json(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

function mockApi(grades: Grade[]) {
  const answerBodies: Array<{ choice: string | null }> = []
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/health') return json({ ok: true, db: true })
    if (url === '/api/runs') {
      return json(
        {
          runId: '00000000-0000-4000-8000-000000000000',
          runToken: RUN_TOKEN,
          date: '2026-10-11',
          questionIndex: 0,
          question: publicQuestion(0),
          progress: { score: 0, strikes: 0, streak: 0 },
          total: null,
        },
        201,
      )
    }
    if (url === '/api/answer') {
      const body = JSON.parse(String(init?.body)) as {
        questionIndex: number
        choice: string | null
      }
      answerBodies.push(body)
      const grade = grades.shift() ?? { correct: true, strikes: 0, streak: 1 }
      return json({
        correct: grade.correct,
        points: grade.correct ? 300 : 0,
        answer: `B${body.questionIndex}`,
        teach: `Teach ${body.questionIndex}.`,
        source: { url: 'https://example.com', ref: 'Rule 1' },
        progress: { score: 300, strikes: grade.strikes, streak: grade.streak },
        next: { questionIndex: body.questionIndex + 1 },
        summary: null,
      })
    }
    if (url === '/api/question') {
      const { questionIndex } = JSON.parse(String(init?.body)) as {
        questionIndex: number
      }
      return json({ questionIndex, question: publicQuestion(questionIndex), elapsedMs: 0 })
    }
    return json({ error: 'not_found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { answerBodies }
}

async function startClassic() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Start classic' }))
  const heading = await screen.findByRole(
    'heading',
    { level: 2, name: /Question 1:\s*Prompt 0\?/ },
    { timeout: 3000 },
  )
  await waitFor(() => expect(document.activeElement).toBe(heading))
  return heading
}

describe('App keyboard and screen-reader play', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('focuses the question, answers with letter keys and announces a correct answer', async () => {
    const { answerBodies } = mockApi([{ correct: true, strikes: 0, streak: 1 }])
    await startClassic()

    expect(screen.getByRole('img', { name: '0 of 3 strikes' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Time remaining' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'b' })

    await waitFor(() => expect(answerBodies).toHaveLength(1))
    expect(answerBodies[0].choice).toBe('B0')
    await waitFor(() =>
      expect(screen.getByText('Correct! Plus 300. Streak 1.')).toBeTruthy(),
    )
  })

  it('answers with number keys and ignores modified keys', async () => {
    const { answerBodies } = mockApi([{ correct: true, strikes: 0, streak: 1 }])
    await startClassic()

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(window, { key: '5' })
    expect(answerBodies).toHaveLength(0)

    fireEvent.keyDown(window, { key: '4' })
    await waitFor(() => expect(answerBodies).toHaveLength(1))
    expect(answerBodies[0].choice).toBe('D0')
  })

  it('focuses the teach card with the verdict after a wrong answer', async () => {
    mockApi([{ correct: false, strikes: 1, streak: 0 }])
    await startClassic()

    fireEvent.keyDown(window, { key: 'a' })

    const teach = await screen.findByRole('button', {
      name: /^Wrong\. Strike 1 of 3\.\s*THE RIGHT ANSWER\s*B0/,
    })
    await waitFor(() => expect(document.activeElement).toBe(teach))

    fireEvent.click(teach)
    const next = await screen.findByRole(
      'heading',
      { level: 2, name: /Question 2:\s*Prompt 1\?/ },
      { timeout: 3000 },
    )
    await waitFor(() => expect(document.activeElement).toBe(next))
  })

  it('keeps a keyboard-answered teach card until the player continues', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi([{ correct: false, strikes: 1, streak: 0 }])
    await startClassic()

    fireEvent.keyDown(window, { key: 'a' })
    const teach = await screen.findByRole('button', { name: /^Wrong\./ })
    expect(screen.getByText('Press Enter to continue')).toBeTruthy()

    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(teach.isConnected).toBe(true)
    vi.useRealTimers()
  })

  it("says Time's up when the chosen answer was correct but late", async () => {
    mockApi([{ correct: false, strikes: 1, streak: 0 }])
    await startClassic()

    fireEvent.keyDown(window, { key: 'b' })
    expect(
      await screen.findByRole('button', { name: /^Time’s up\. Strike 1 of 3\./ }),
    ).toBeTruthy()
  })

  it('leaves a run without a blocking confirm and returns focus to the start button', async () => {
    mockApi([])
    await startClassic()
    const confirm = vi.spyOn(window, 'confirm')

    fireEvent.click(screen.getByRole('button', { name: 'Back home' }))
    const start = await screen.findByRole('button', { name: 'Start classic' })
    await waitFor(() => expect(document.activeElement).toBe(start))
    expect(confirm).not.toHaveBeenCalled()
  })
})

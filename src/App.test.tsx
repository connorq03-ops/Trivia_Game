// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { BOSS_CLOCK_MS, BOSS_REEL_MS, REEL_MS } from './game/engine'
import { REVEAL_MS } from './game/reveal'

const RUN_TOKEN = 'x'.repeat(43)

function publicQuestion(index: number, withBadges = false) {
  return {
    id: `q${index}`,
    side: 'rules',
    sport: 'football',
    leagues: ['NFL'],
    difficulty: 'easy',
    category: 'Scoring',
    prompt: `Prompt ${index}?`,
    choices: [`A${index}`, `B${index}`, `C${index}`, `D${index}`],
    ...(withBadges
      ? {
          choiceBadges: [
            { kind: 'team', abbr: 'MIN', primary: '#4f2683', secondary: '#ffc62f' },
            null,
            { kind: 'flag', code: 'fr' },
            null,
          ],
        }
      : {}),
  }
}

type Grade = { correct: boolean; strikes: number; streak: number; points?: number }

function json(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

function bossQuestion(index: number, category: string) {
  return {
    ...publicQuestion(index),
    side: 'boss',
    sport: 'boss',
    leagues: [],
    difficulty: 'expert',
    category,
    boss: { category, clockMs: BOSS_CLOCK_MS, reelMs: BOSS_REEL_MS },
  }
}

function mockApi(
  grades: Grade[],
  answerPending = false,
  withBadges = false,
  bossAt: Record<number, string> = {},
) {
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
          question: publicQuestion(0, withBadges),
          progress: { score: 0, strikes: 0, streak: 0 },
          total: JSON.parse(String(init?.body)).mode === 'daily' ? 10 : null,
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
      if (answerPending) return new Promise(() => {})
      const grade = grades.shift() ?? { correct: true, strikes: 0, streak: 1 }
      return json({
        correct: grade.correct,
        points: grade.points ?? (grade.correct ? 300 : 0),
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
      const question = bossAt[questionIndex]
        ? bossQuestion(questionIndex, bossAt[questionIndex])
        : publicQuestion(questionIndex)
      return json({ questionIndex, question, elapsedMs: 0 })
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
    vi.useRealTimers()
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

  it('shows the streak ring in Classic and the 10-step track in Daily 10', async () => {
    mockApi([])
    await startClassic()
    expect(screen.getByRole('img', { name: /streak, strike back at/ })).toBeTruthy()
    cleanup()

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Play Daily 10/ }))
    await screen.findByRole(
      'heading',
      { level: 2, name: /Question 1:\s*Prompt 0\?/ },
      { timeout: 3000 },
    )
    expect(screen.getByText('0 missed')).toBeTruthy()
    expect(screen.queryByRole('img', { name: /streak/ })).toBeNull()
    expect(screen.getByText('QUESTION 1 OF 10')).toBeTruthy()
    const track = screen.getByRole('progressbar', { name: 'Daily 10 progress' })
    expect(track.getAttribute('aria-valuenow')).toBe('0')
    expect(track.getAttribute('aria-valuemax')).toBe('10')
  })

  it('introduces a boss with a banner and the server-picked category, then runs a 15s clock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi(
      [
        { correct: true, strikes: 0, streak: 1 },
        { correct: false, strikes: 0, streak: 1, points: -250 },
      ],
      false,
      false,
      { 1: 'history' },
    )
    await startClassic()

    fireEvent.keyDown(window, { key: 'b' })
    await act(() => vi.advanceTimersByTimeAsync(REVEAL_MS + 50))

    expect(await screen.findByRole('heading', { level: 2, name: 'Boss question' })).toBeTruthy()
    const reel = document.querySelector<HTMLElement>('.boss-reel')
    expect(reel?.dataset.category).toBe('history')
    expect(reel?.style.getPropertyValue('--boss-turn')).toBe('1665deg')
    expect(document.querySelector('.boss-category')?.textContent).toBe('History')
    expect(
      screen.getByText('Boss question: History. 15 seconds. Plus 500 if right, minus 250 if wrong, no strike.'),
    ).toBeTruthy()

    await act(() => vi.advanceTimersByTimeAsync(BOSS_REEL_MS))
    await screen.findByRole('heading', { level: 2, name: /Question 2:\s*Prompt 1\?/ })
    const clock = screen.getByRole('progressbar', { name: 'Time remaining' })
    expect(clock.getAttribute('aria-valuemax')).toBe('15')
    expect(document.querySelector('.boss-chip')?.textContent).toBe('Boss')

    fireEvent.click(screen.getByRole('button', { name: 'AA1' }))
    expect(await screen.findByText('−250')).toBeTruthy()
    expect(screen.getByRole('img', { name: '0 of 3 strikes' })).toBeTruthy()
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

  it('keeps the picked answer and visible clock steady while the answer is pending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi([], true)
    await startClassic()

    await act(() => vi.advanceTimersByTimeAsync(REEL_MS / 2))
    const clock = screen.getByRole('progressbar', { name: 'Time remaining' })
    const secondsAtPick = clock.getAttribute('aria-valuenow')
    expect(Number(secondsAtPick)).toBeLessThan(10)

    const pickedButton = screen.getByRole('button', { name: 'AA0' })
    fireEvent.click(pickedButton)

    expect(pickedButton.classList.contains('is-picked')).toBe(true)
    expect(clock.getAttribute('aria-valuenow')).toBe(secondsAtPick)

    await act(() => vi.advanceTimersByTimeAsync(REEL_MS))
    expect(clock.getAttribute('aria-valuenow')).toBe(secondsAtPick)
  })

  it('zeros the clock for a late correct pick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi([{ correct: false, strikes: 1, streak: 0 }])
    await startClassic()

    await act(() => vi.advanceTimersByTimeAsync(REEL_MS / 2))
    const clock = screen.getByRole('progressbar', { name: 'Time remaining' })
    expect(Number(clock.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    expect(Number(clock.getAttribute('aria-valuenow'))).toBeLessThan(10)

    fireEvent.click(screen.getByRole('button', { name: 'BB0' }))

    expect(await screen.findByText("Time's up")).toBeTruthy()
    expect(clock.getAttribute('aria-valuenow')).toBe('0')
  })

  it('announces a wrong answer and focuses the Teach Continue button', async () => {
    mockApi([{ correct: false, strikes: 1, streak: 0 }])
    await startClassic()

    fireEvent.keyDown(window, { key: 'a' })

    await waitFor(() => expect(screen.getByText('Wrong. Strike 1 of 3.')).toBeTruthy())
    const next = await screen.findByRole('button', { name: 'Continue' }, { timeout: 3000 })
    await waitFor(() => expect(document.activeElement).toBe(next))
    expect(next.getAttribute('aria-describedby')).toBe('teach-pick teach-answer teach-text')
    expect(screen.getByText('Right answer: B0')).toBeTruthy()

    fireEvent.click(next)
    const heading = await screen.findByRole(
      'heading',
      { level: 2, name: /Question 2:\s*Prompt 1\?/ },
      { timeout: 3000 },
    )
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('keeps the Teach card until the player continues', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi([{ correct: false, strikes: 1, streak: 0 }])
    await startClassic()

    fireEvent.keyDown(window, { key: 'a' })
    const next = await screen.findByRole('button', { name: 'Continue' }, { timeout: 3000 })

    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(next.isConnected).toBe(true)
    vi.useRealTimers()
  })

  it("says Time's up when the chosen answer was correct but late", async () => {
    mockApi([{ correct: false, strikes: 1, streak: 0 }])
    await startClassic()

    fireEvent.keyDown(window, { key: 'b' })
    await waitFor(() =>
      expect(screen.getByText('Time’s up. Strike 1 of 3.')).toBeTruthy(),
    )
  })

  it('keeps the choice text as the accessible name when a badge is present', async () => {
    mockApi([], false, true)
    await startClassic()

    const button = screen.getByRole('button', { name: 'AA0' })
    expect(button.querySelectorAll('[aria-hidden="true"]').length).toBe(1)
    const badge = button.querySelector('.answer-badge--team')
    expect(badge?.textContent).toBe('MIN')
    const flag = screen
      .getByRole('button', { name: 'CC0' })
      .querySelector('.answer-badge--flag')
    expect(flag?.getAttribute('aria-hidden')).toBe('true')
    expect(flag?.getAttribute('src')).toBe('/flags/fr.svg')
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

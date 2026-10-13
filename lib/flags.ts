export function bossQuestionsEnabled(): boolean {
  const flag = process.env.BOSS_QUESTIONS?.trim().toLowerCase()
  return flag === '1' || flag === 'true'
}

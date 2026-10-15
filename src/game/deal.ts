declare const __DAILY_DEAL__: string

// Build-time fingerprint of everything that determines today's dealt set
// (engine quotas + content bank, hashed in vite.config.ts). When a deploy
// redeals the Daily, summaries saved under the old deal no longer count as
// "played", so the new set opens like a brand-new Daily.
export const DAILY_DEAL: string = __DAILY_DEAL__

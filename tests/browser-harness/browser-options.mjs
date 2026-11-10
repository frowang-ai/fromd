// Shared browser selection for Playwright Test and standalone screenshot/probe scripts.
// Default: Playwright's managed Chromium (`npx playwright install chromium`).
export function browserLaunchOptions() {
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH }
  return process.env.PW_BROWSER_CHANNEL ? { channel: process.env.PW_BROWSER_CHANNEL } : {}
}

// Launches a Chromium browser for rendering and screenshots.
//
// Order of attempts:
//   1. The Chromium that `npx playwright install chromium` downloads.
//   2. Google Chrome installed on the machine (Playwright channel "chrome").
//   3. Microsoft Edge installed on the machine (channel "msedge").
//
// If none works, BrowserUnavailableError explains what to run.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class BrowserUnavailableError extends Error {
  constructor(attempts) {
    const tried = attempts.map((a) => `  - ${a.kind}: ${a.error}`).join('\n');
    super(
      `No Chromium-based browser is available for Playwright.\n${tried}\n` +
        `Install one with:\n  cd "${PLUGIN_ROOT}" && npx playwright install chromium\n` +
        `or install Google Chrome / Microsoft Edge on this machine.`,
    );
    this.name = 'BrowserUnavailableError';
    this.attempts = attempts;
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (err) {
    throw new BrowserUnavailableError([
      { kind: 'playwright module', error: `not installed (${err.message}). Run: cd "${PLUGIN_ROOT}" && npm install` },
    ]);
  }
}

/**
 * Launches a browser, trying bundled Chromium, then Chrome, then Edge.
 * @param {{ headless?: boolean, playwright?: object }} [options]
 *   `playwright` lets tests inject a fake module with a `chromium` object.
 * @returns {Promise<{ browser: import('playwright').Browser, kind: string }>}
 */
export async function launchBrowser(options = {}) {
  const pw = options.playwright || (await loadPlaywright());
  const headless = options.headless !== false;
  const attempts = [];

  const candidates = [
    {
      kind: 'chromium',
      available: () => {
        try {
          const exe = pw.chromium.executablePath();
          return exe && existsSync(exe);
        } catch {
          return false;
        }
      },
      launch: () => pw.chromium.launch({ headless }),
    },
    { kind: 'chrome', available: () => true, launch: () => pw.chromium.launch({ headless, channel: 'chrome' }) },
    { kind: 'msedge', available: () => true, launch: () => pw.chromium.launch({ headless, channel: 'msedge' }) },
  ];

  for (const candidate of candidates) {
    if (!candidate.available()) {
      attempts.push({ kind: candidate.kind, error: 'executable not found' });
      continue;
    }
    try {
      const browser = await candidate.launch();
      return { browser, kind: candidate.kind };
    } catch (err) {
      attempts.push({ kind: candidate.kind, error: firstLine(err.message) });
    }
  }
  throw new BrowserUnavailableError(attempts);
}

/**
 * Checks whether a browser can be launched, without keeping it open.
 * @param {{ playwright?: object }} [options]
 * @returns {Promise<{ ok: boolean, kind: string|null, error: string|null }>}
 */
export async function probeBrowser(options = {}) {
  try {
    const { browser, kind } = await launchBrowser(options);
    await browser.close();
    return { ok: true, kind, error: null };
  } catch (err) {
    return { ok: false, kind: null, error: err.message };
  }
}

function firstLine(text) {
  return String(text || '').split('\n')[0].trim();
}

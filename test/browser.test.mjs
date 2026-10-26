import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, probeBrowser, BrowserUnavailableError } from '../scripts/lib/browser.mjs';

function fakePlaywright({ bundledPath = '/nope/chromium', launches = {} } = {}) {
  const calls = [];
  return {
    calls,
    chromium: {
      executablePath: () => bundledPath,
      launch: async (opts = {}) => {
        const key = opts.channel || 'chromium';
        calls.push(key);
        if (launches[key] === 'ok') return { close: async () => {}, kind: key };
        throw new Error(launches[key] || `${key} is not installed`);
      },
    },
  };
}

test('falls back to Chrome when bundled Chromium is missing', async () => {
  const pw = fakePlaywright({ launches: { chrome: 'ok' } });
  const { kind } = await launchBrowser({ playwright: pw });
  assert.equal(kind, 'chrome');
  assert.deepEqual(pw.calls, ['chrome']);
});

test('falls back to Edge when Chrome fails to launch', async () => {
  const pw = fakePlaywright({ launches: { chrome: 'Chromium distribution "chrome" is not found', msedge: 'ok' } });
  const { kind } = await launchBrowser({ playwright: pw });
  assert.equal(kind, 'msedge');
  assert.deepEqual(pw.calls, ['chrome', 'msedge']);
});

test('explains how to install a browser when nothing works', async () => {
  const pw = fakePlaywright({ launches: { chrome: 'missing', msedge: 'missing' } });
  await assert.rejects(launchBrowser({ playwright: pw }), (err) => {
    assert.ok(err instanceof BrowserUnavailableError);
    assert.match(err.message, /npx playwright install chromium/);
    assert.match(err.message, /chromium: executable not found/);
    return true;
  });
});

test('probeBrowser reports ok=false with the message instead of throwing', async () => {
  const pw = fakePlaywright({ launches: { chrome: 'missing', msedge: 'missing' } });
  const result = await probeBrowser({ playwright: pw });
  assert.equal(result.ok, false);
  assert.match(result.error, /playwright install/);
});

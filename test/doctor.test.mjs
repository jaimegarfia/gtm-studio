import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, formatReport } from '../scripts/doctor.mjs';

const okProbe = async () => ({ ok: true, kind: 'chromium', error: null });
const noBrowser = async () => ({ ok: false, kind: null, error: 'none' });

test('empty project: ready, next step is brand', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gtm-doc-'));
  const report = await runDoctor({ projectRoot: root, probe: okProbe });
  assert.equal(report.ready, true);
  assert.equal(report.project.brand, null);
  assert.match(report.nextStep, /gtm-studio:brand/);
  assert.match(formatReport(report), /Status: ready/);
});

test('missing browser is a warning, not a blocker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gtm-doc-'));
  const report = await runDoctor({ projectRoot: root, probe: noBrowser });
  assert.equal(report.ready, true);
  const browser = report.checks.find((c) => c.id === 'browser');
  assert.equal(browser.level, 'warn');
  assert.match(browser.fix, /playwright install chromium/);
});

test('reads brand and calendar state and points to the next command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gtm-doc-'));
  await mkdir(join(root, 'marketing', 'posts', '2026-11-03-x'), { recursive: true });
  await writeFile(
    join(root, 'marketing', 'brand.md'),
    '# X\n\n<!-- gtm-studio:tokens -->\n```json\n{"product":"X","language":"es"}\n```\n',
  );
  await writeFile(
    join(root, 'marketing', 'calendar.json'),
    JSON.stringify({ network: 'linkedin', posts: [{ status: 'created' }, { status: 'pending' }] }),
  );
  const report = await runDoctor({ projectRoot: root, probe: okProbe });
  assert.equal(report.project.brand.language, 'es');
  assert.equal(report.project.calendar.pending, 1);
  assert.equal(report.project.postDirs, 1);
  assert.match(report.nextStep, /gtm-studio:create/);
});

test('broken tokens block is reported with the parser message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gtm-doc-'));
  await mkdir(join(root, 'marketing'), { recursive: true });
  await writeFile(join(root, 'marketing', 'brand.md'), '# X\n\nno tokens\n');
  const report = await runDoctor({ projectRoot: root, probe: okProbe });
  assert.equal(report.project.brand.ok, false);
  assert.match(report.project.brand.error, /gtm-studio:tokens/);
  assert.match(report.nextStep, /Fix the tokens block/);
});

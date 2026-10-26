#!/usr/bin/env node
// Checks that GTM Studio can run on this machine and reports the state of the
// project's marketing/ folder.
//
// Usage: node doctor.mjs [--project-root DIR] [--json]

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN_ROOT, probeBrowser } from './lib/browser.mjs';
import { parseBrandTokens } from './lib/brand.mjs';

const MIN_NODE_MAJOR = 20;

/**
 * Runs every check.
 * @param {{ projectRoot?: string, probe?: typeof probeBrowser }} [options]
 */
export async function runDoctor(options = {}) {
  const projectRoot = resolve(options.projectRoot || process.cwd());
  const probe = options.probe || probeBrowser;
  const checks = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node',
    ok: nodeMajor >= MIN_NODE_MAJOR,
    level: nodeMajor >= MIN_NODE_MAJOR ? 'ok' : 'error',
    message: `Node ${process.versions.node} (>= ${MIN_NODE_MAJOR} required)`,
    fix: nodeMajor >= MIN_NODE_MAJOR ? null : 'Install Node LTS from https://nodejs.org and restart Claude Code.',
  });

  let playwrightVersion = null;
  try {
    const require = createRequire(join(PLUGIN_ROOT, 'package.json'));
    const pkgPath = require.resolve('playwright/package.json');
    playwrightVersion = JSON.parse(await readFile(pkgPath, 'utf8')).version;
  } catch {
    playwrightVersion = null;
  }
  checks.push({
    id: 'playwright',
    ok: Boolean(playwrightVersion),
    level: playwrightVersion ? 'ok' : 'error',
    message: playwrightVersion ? `Playwright ${playwrightVersion} installed in the plugin` : 'Playwright is not installed in the plugin',
    fix: playwrightVersion ? null : `Run: cd "${PLUGIN_ROOT}" && npm install`,
  });

  let browser = { ok: false, kind: null, error: 'skipped because Playwright is missing' };
  if (playwrightVersion) browser = await probe();
  checks.push({
    id: 'browser',
    ok: browser.ok,
    level: browser.ok ? 'ok' : 'warn',
    message: browser.ok ? `Browser available (${browser.kind})` : 'No browser available for rendering',
    fix: browser.ok ? null : `Run: cd "${PLUGIN_ROOT}" && npx playwright install chromium (or install Chrome/Edge). Needed by /gtm-studio:create, not by brand or plan.`,
  });

  const marketing = join(projectRoot, 'marketing');
  const brandPath = join(marketing, 'brand.md');
  const calendarPath = join(marketing, 'calendar.json');
  const project = {
    root: projectRoot,
    marketingDir: existsSync(marketing),
    brand: null,
    calendar: null,
  };
  if (existsSync(brandPath)) {
    try {
      const tokens = parseBrandTokens(await readFile(brandPath, 'utf8'));
      project.brand = { ok: true, product: tokens.product, language: tokens.language, error: null };
    } catch (err) {
      project.brand = { ok: false, product: null, language: null, error: err.message };
    }
  }
  if (existsSync(calendarPath)) {
    try {
      const cal = JSON.parse(await readFile(calendarPath, 'utf8'));
      const posts = Array.isArray(cal.posts) ? cal.posts : [];
      project.calendar = {
        ok: true,
        network: cal.network || null,
        total: posts.length,
        pending: posts.filter((p) => p.status === 'pending').length,
        created: posts.filter((p) => p.status === 'created').length,
        error: null,
      };
    } catch (err) {
      project.calendar = { ok: false, error: err.message };
    }
  }
  let postDirs = 0;
  try {
    postDirs = (await readdir(join(marketing, 'posts'), { withFileTypes: true })).filter((d) => d.isDirectory()).length;
  } catch {
    postDirs = 0;
  }
  project.postDirs = postDirs;

  const nextStep = !project.brand
    ? 'Run /gtm-studio:brand to create marketing/brand.md.'
    : !project.brand.ok
      ? 'Fix the tokens block in marketing/brand.md (see error above) or re-run /gtm-studio:brand.'
      : !project.calendar
        ? 'Run /gtm-studio:plan to create the 4-week calendar.'
        : project.calendar.pending > 0
          ? `Run /gtm-studio:create to write the ${project.calendar.pending} pending post(s).`
          : 'All posts are created. Open marketing/calendar.html to review them.';

  const errors = checks.filter((c) => c.level === 'error');
  return { pluginRoot: PLUGIN_ROOT, ready: errors.length === 0, checks, project, nextStep };
}

export function formatReport(report) {
  const icon = { ok: '✔', warn: '⚠', error: '✘' };
  const lines = [`GTM Studio doctor (plugin at ${report.pluginRoot})`, ''];
  for (const c of report.checks) {
    lines.push(`${icon[c.level]} ${c.message}`);
    if (c.fix) lines.push(`    ${c.fix}`);
  }
  lines.push('', `Project: ${report.project.root}`);
  const p = report.project;
  lines.push(p.brand ? (p.brand.ok ? `✔ marketing/brand.md (${p.brand.product}, language "${p.brand.language}")` : `✘ marketing/brand.md: ${p.brand.error}`) : '· marketing/brand.md not found');
  lines.push(
    p.calendar
      ? p.calendar.ok
        ? `✔ marketing/calendar.json (${p.calendar.network}: ${p.calendar.created} created, ${p.calendar.pending} pending of ${p.calendar.total})`
        : `✘ marketing/calendar.json: ${p.calendar.error}`
      : '· marketing/calendar.json not found',
  );
  lines.push(`· ${p.postDirs} post folder(s) in marketing/posts`);
  lines.push('', `Status: ${report.ready ? 'ready' : 'needs setup'}`, `Next step: ${report.nextStep}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-root') args.projectRoot = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node doctor.mjs [--project-root DIR] [--json]');
    process.exit(0);
  }
  runDoctor({ projectRoot: args.projectRoot })
    .then((report) => {
      process.stdout.write((args.json ? JSON.stringify(report, null, 2) : formatReport(report)) + '\n');
      process.exit(report.ready ? 0 : 1);
    })
    .catch((err) => {
      console.error(`doctor failed: ${err.message}`);
      process.exit(1);
    });
}

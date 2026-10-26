#!/usr/bin/env node
// Captures real screenshots of the product with Playwright, optionally
// starting the app first and stopping it afterwards.
//
// Usage:
//   node capture-screens.mjs --url http://localhost:3000 --out DIR
//        [--routes /,/pricing] [--devices desktop,mobile]
//        [--start "npm run dev" --cwd DIR] [--timeout 120000] [--settle 1500]
//        [--full-page] [--no-dismiss]
//
// Writes <out>/<route>-<device>.png for every route and device, plus
// <out>/manifest.json. When --start is given, the dev server's output goes to
// <out>/dev-server.log and the process tree is killed at the end.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './lib/browser.mjs';

export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export class CaptureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CaptureError';
  }
}

export function routeSlug(route) {
  const clean = String(route).replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'home';
}

/**
 * Accepts routes with or without a leading slash ("pricing", "/pricing"),
 * "home" or "." for the root, and undoes the path conversion Git Bash on
 * Windows applies to a bare "/" argument (it becomes "C:/Program Files/Git/").
 */
export function normalizeRoute(route) {
  let r = String(route || '').trim();
  if (/^[A-Za-z]:[\\/]/.test(r) || /^\/[A-Za-z]:[\\/]/.test(r)) r = '/';
  if (r === '' || r === '.' || r === 'home') r = '/';
  if (!r.startsWith('/')) r = `/${r}`;
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return res.status < 500 || res.status === 503 ? res.status < 500 : false;
  } catch {
    return false;
  }
}

async function tail(file, lines = 30) {
  try {
    const text = await readFile(file, 'utf8');
    return text.trim().split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Starts the dev server and waits until `url` answers.
 */
export async function startServer({ command, cwd, url, timeout, logFile }) {
  const fd = openSync(logFile, 'a');
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', fd, fd],
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', CI: process.env.CI || '1' },
  });
  closeSync(fd);
  const started = Date.now();
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  while (Date.now() - started < timeout) {
    if (await isUp(url)) return child;
    if (exited) {
      throw new CaptureError(`The dev server exited before ${url} answered. Last lines of ${logFile}:\n${await tail(logFile)}`);
    }
    await sleep(750);
  }
  killTree(child);
  throw new CaptureError(`Timed out after ${timeout} ms waiting for ${url}. Last lines of ${logFile}:\n${await tail(logFile)}`);
}

const DISMISS_RE = /^(accept( all)?|aceptar( todo| todas)?|agree|i agree|got it|ok|okay|entendido|allow all|permitir( todas)?|aceitar|accepter|akzeptieren|accetta)$/i;

async function dismissBanners(page) {
  try {
    const button = page.getByRole('button', { name: DISMISS_RE }).first();
    await button.waitFor({ state: 'visible', timeout: 800 });
    await button.click({ timeout: 1000 });
    await sleep(300);
  } catch {
    /* no banner */
  }
}

/**
 * Captures screenshots. Returns the manifest entries.
 */
export async function captureScreens(options) {
  const url = String(options.url || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(url)) throw new CaptureError('--url must start with http:// or https://');
  const out = resolve(options.out);
  const routes = [...new Set((options.routes && options.routes.length ? options.routes : ['/']).map(normalizeRoute))];
  const deviceNames = options.devices && options.devices.length ? options.devices : ['desktop', 'mobile'];
  for (const d of deviceNames) if (!DEVICES[d]) throw new CaptureError(`Unknown device "${d}". Use: ${Object.keys(DEVICES).join(', ')}.`);
  const timeout = Number(options.timeout || 120000);
  const settle = Number(options.settle ?? 1500);
  await mkdir(out, { recursive: true });

  let server = null;
  const logFile = join(out, 'dev-server.log');
  if (options.start) {
    if (await isUp(url)) {
      options.log?.(`Something already answers at ${url}; not starting "${options.start}".`);
    } else {
      options.log?.(`Starting "${options.start}" in ${options.cwd || process.cwd()} and waiting for ${url}…`);
      server = await startServer({ command: options.start, cwd: options.cwd ? resolve(options.cwd) : process.cwd(), url, timeout, logFile });
    }
  } else if (!(await isUp(url))) {
    throw new CaptureError(`Nothing answers at ${url}. Start the app first or pass --start "<command>" --cwd <dir>.`);
  }

  const entries = [];
  const warnings = [];
  let browserKind = null;
  try {
    const { browser, kind } = await launchBrowser();
    browserKind = kind;
    try {
      for (const deviceName of deviceNames) {
        const context = await browser.newContext({ ...DEVICES[deviceName], locale: options.locale || undefined });
        const page = await context.newPage();
        for (const route of routes) {
          const target = `${url}${route}`;
          try {
            try {
              await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
            } catch {
              await page.goto(target, { waitUntil: 'load', timeout: 30000 });
            }
            if (options.dismiss !== false) await dismissBanners(page);
            await page.addStyleTag({ content: '::-webkit-scrollbar{display:none} html{scrollbar-width:none}' });
            if (settle > 0) await sleep(settle);
            const file = join(out, `${routeSlug(route)}-${deviceName}.png`);
            await page.screenshot({ path: file, fullPage: Boolean(options.fullPage) });
            const { viewport, deviceScaleFactor } = DEVICES[deviceName];
            entries.push({ route, device: deviceName, file, url: target, width: viewport.width * deviceScaleFactor, height: viewport.height * deviceScaleFactor });
            options.log?.(`Captured ${route} (${deviceName}) → ${file}`);
          } catch (err) {
            warnings.push(`${route} (${deviceName}): ${err.message.split('\n')[0]}`);
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server) {
      killTree(server);
      options.log?.('Stopped the dev server.');
    }
  }
  const manifest = { url, capturedAt: new Date().toISOString(), browser: browserKind, screens: entries, warnings };
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key.startsWith('no-')) args[key.slice(3)] = false;
    else if (next === undefined || next.startsWith('--')) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url || !args.out) {
    console.log(
      'Usage: node capture-screens.mjs --url URL --out DIR [--routes home,pricing,es/app] [--devices desktop,mobile] [--start "npm run dev" --cwd DIR] [--timeout 120000] [--settle 1500] [--full-page] [--no-dismiss]',
    );
    process.exit(args.help ? 0 : 1);
  }
  const split = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  captureScreens({
    url: args.url,
    out: args.out,
    routes: split(args.routes),
    devices: split(args.devices),
    start: typeof args.start === 'string' ? args.start : undefined,
    cwd: args.cwd,
    timeout: args.timeout,
    settle: args.settle,
    fullPage: Boolean(args['full-page']),
    dismiss: args.dismiss !== false,
    log: (line) => console.error(line),
  })
    .then((manifest) => {
      console.log(JSON.stringify(manifest, null, 2));
      process.exit(manifest.screens.length ? 0 : 1);
    })
    .catch((err) => {
      console.error(err.name === 'CaptureError' || err.name === 'BrowserUnavailableError' ? err.message : err.stack);
      process.exit(1);
    });
}

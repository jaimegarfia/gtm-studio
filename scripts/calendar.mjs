#!/usr/bin/env node
// Manages marketing/calendar.json and marketing/calendar.md.
//
// Usage:
//   node calendar.mjs init --marketing DIR --network FILE --slots FILE|- [--start YYYY-MM-DD] [--force]
//   node calendar.mjs set-status --marketing DIR --network FILE --id ID --status pending|created
//   node calendar.mjs list --marketing DIR [--status pending|created] [--date YYYY-MM-DD]
//   node calendar.mjs render-md --marketing DIR --network FILE
//
// `init` reads the slots Claude wrote (week, slot, format, goal, topic, angle,
// slug), validates them against the network spec, computes dates and writes
// both files. The calendar always starts on a Monday.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBrand } from './lib/brand.mjs';
import {
  CalendarError,
  assertStatus,
  buildCalendar,
  nextMonday,
  parseDate,
  renderCalendarMarkdown,
  snapToMonday,
  todayIso,
} from './lib/calendar.mjs';

export { CalendarError };

async function loadJson(path, what) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new CalendarError(`Cannot find ${what} at ${path}.`);
    throw new CalendarError(`${what} at ${path} is not valid JSON: ${err.message}`);
  }
}

async function readCalendar(marketing) {
  const path = join(marketing, 'calendar.json');
  if (!existsSync(path)) throw new CalendarError(`Cannot find ${path}. Run /gtm-studio:plan first.`);
  return loadJson(path, 'calendar.json');
}

async function writeCalendarFiles(marketing, calendar, network) {
  const { tokens } = await readBrand(join(marketing, 'brand.md'));
  await mkdir(marketing, { recursive: true });
  await writeFile(join(marketing, 'calendar.json'), JSON.stringify(calendar, null, 2) + '\n', 'utf8');
  const md = renderCalendarMarkdown(calendar, network, { language: tokens.language, product: tokens.product });
  await writeFile(join(marketing, 'calendar.md'), md, 'utf8');
}

/**
 * Creates calendar.json and calendar.md.
 * @returns {Promise<{ startDate: string, snapped: boolean, posts: number, calendarJson: string, calendarMd: string }>}
 */
export async function initCalendar({ marketing, network, slots, startDate, today, force = false }) {
  marketing = resolve(marketing);
  const jsonPath = join(marketing, 'calendar.json');
  if (existsSync(jsonPath) && !force) {
    throw new CalendarError(`${jsonPath} already exists. Pass --force to replace it.`);
  }
  let snapped = false;
  let start;
  if (startDate) {
    parseDate(startDate);
    start = snapToMonday(startDate);
    snapped = start !== startDate;
  } else {
    start = nextMonday(today || todayIso());
  }
  const calendar = buildCalendar({ network, slots, startDate: start });
  await writeCalendarFiles(marketing, calendar, network);
  return {
    startDate: start,
    snapped,
    posts: calendar.posts.length,
    calendarJson: jsonPath,
    calendarMd: join(marketing, 'calendar.md'),
  };
}

/**
 * Updates one post's status and re-renders calendar.md.
 */
export async function setStatus({ marketing, network, id, date, status }) {
  marketing = resolve(marketing);
  assertStatus(status);
  const calendar = await readCalendar(marketing);
  const post = calendar.posts.find((p) => (id ? p.id === id : p.date === date));
  if (!post) throw new CalendarError(`No post with ${id ? `id "${id}"` : `date "${date}"`} in calendar.json.`);
  post.status = status;
  await writeCalendarFiles(marketing, calendar, network);
  return post;
}

/**
 * Lists posts, optionally filtered by status and/or date.
 */
export async function listPosts({ marketing, status, date }) {
  marketing = resolve(marketing);
  const calendar = await readCalendar(marketing);
  if (status) assertStatus(status);
  if (date) parseDate(date);
  return calendar.posts.filter((p) => (!status || p.status === status) && (!date || p.date === date));
}

/**
 * Re-renders calendar.md from calendar.json.
 */
export async function renderMarkdown({ marketing, network }) {
  marketing = resolve(marketing);
  const calendar = await readCalendar(marketing);
  await writeCalendarFiles(marketing, calendar, network);
  return join(marketing, 'calendar.md');
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else args[key] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function readSlots(source) {
  if (source === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      throw new CalendarError(`Slots on stdin are not valid JSON: ${err.message}`);
    }
  }
  return loadJson(resolve(source), 'slots file');
}

const USAGE = `Usage:
  node calendar.mjs init --marketing DIR --network FILE --slots FILE|- [--start YYYY-MM-DD] [--force]
  node calendar.mjs set-status --marketing DIR --network FILE (--id ID | --date YYYY-MM-DD) --status pending|created
  node calendar.mjs list --marketing DIR [--status pending|created] [--date YYYY-MM-DD]
  node calendar.mjs render-md --marketing DIR --network FILE`;

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.marketing) throw new CalendarError('--marketing DIR is required.');
  const needNetwork = ['init', 'set-status', 'render-md'].includes(cmd);
  const network = needNetwork ? await loadJson(resolve(args.network || ''), 'network spec') : null;

  switch (cmd) {
    case 'init': {
      if (!args.slots) throw new CalendarError('--slots FILE (or - for stdin) is required.');
      const slots = await readSlots(args.slots);
      const result = await initCalendar({
        marketing: args.marketing,
        network,
        slots,
        startDate: typeof args.start === 'string' ? args.start : undefined,
        force: Boolean(args.force),
      });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    case 'set-status': {
      const post = await setStatus({ marketing: args.marketing, network, id: args.id, date: args.date, status: args.status });
      console.log(JSON.stringify(post, null, 2));
      return 0;
    }
    case 'list': {
      const posts = await listPosts({ marketing: args.marketing, status: args.status, date: args.date });
      console.log(JSON.stringify(posts, null, 2));
      return 0;
    }
    case 'render-md': {
      const path = await renderMarkdown({ marketing: args.marketing, network });
      console.log(JSON.stringify({ calendarMd: path }, null, 2));
      return 0;
    }
    default:
      throw new CalendarError(`Unknown command "${cmd}".\n${USAGE}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof CalendarError || err.name === 'BrandTokensError' ? err.message : err.stack);
      process.exit(err instanceof CalendarError && /already exists/.test(err.message) ? 2 : 1);
    });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nextMonday,
  snapToMonday,
  buildCalendar,
  validateSlots,
  renderCalendarMarkdown,
  CalendarError,
} from '../scripts/lib/calendar.mjs';
import { initCalendar, setStatus, listPosts } from '../scripts/calendar.mjs';

const network = JSON.parse(await readFile(new URL('../networks/linkedin/network.json', import.meta.url), 'utf8'));

function slots() {
  const formats = ['carousel', 'text', 'screenshot', 'carousel', 'text', 'screenshot', 'carousel', 'text', 'carousel', 'screenshot', 'text', 'carousel'];
  const goals = ['problem', 'product', 'story', 'problem', 'product', 'cta', 'story', 'product', 'cta', 'problem', 'product', 'cta'];
  const out = [];
  for (let i = 0; i < 12; i++) {
    out.push({
      week: Math.floor(i / 3) + 1,
      slot: i % 3,
      format: formats[i],
      goal: goals[i],
      topic: `Topic ${i + 1}`,
      angle: `Angle ${i + 1}`,
      slug: `topic-${i + 1}`,
    });
  }
  return out;
}

const brandMd = (lang) => `# X\n\n<!-- gtm-studio:tokens -->\n\`\`\`json\n{"product":"CVora","language":"${lang}"}\n\`\`\`\n`;

async function project(lang = 'es') {
  const root = await mkdtemp(join(tmpdir(), 'gtm-cal-'));
  await mkdir(join(root, 'marketing'), { recursive: true });
  await writeFile(join(root, 'marketing', 'brand.md'), brandMd(lang));
  return join(root, 'marketing');
}

test('nextMonday and snapToMonday', () => {
  assert.equal(nextMonday('2026-10-26'), '2026-11-02'); // Monday -> next Monday
  assert.equal(nextMonday('2026-11-01'), '2026-11-02'); // Sunday -> tomorrow
  assert.equal(nextMonday('2026-10-28'), '2026-11-02'); // Wednesday
  assert.equal(snapToMonday('2026-11-02'), '2026-11-02');
  assert.equal(snapToMonday('2026-11-04'), '2026-11-09');
});

test('buildCalendar places 12 posts on Tue/Wed/Thu with ids, dirs and pending status', () => {
  const cal = buildCalendar({ network, slots: slots(), startDate: '2026-11-02', now: '2026-10-26T10:00:00Z' });
  assert.equal(cal.version, 1);
  assert.equal(cal.network, 'linkedin');
  assert.equal(cal.startDate, '2026-11-02');
  assert.equal(cal.posts.length, 12);
  assert.deepEqual(cal.posts.slice(0, 3).map((p) => p.date), ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(cal.posts[11].date, '2026-11-26');
  assert.equal(cal.posts[0].id, '2026-11-03-topic-1');
  assert.equal(cal.posts[0].dir, 'posts/2026-11-03-topic-1');
  assert.equal(cal.posts[0].time, '08:30');
  assert.ok(cal.posts.every((p) => p.status === 'pending'));
  assert.ok(cal.posts.every((p) => p.week >= 1 && p.week <= 4));
});

test('validateSlots rejects bad formats, duplicate slots and missing coverage', () => {
  const bad = slots();
  bad[0].format = 'video';
  assert.throws(() => validateSlots(network, bad), (e) => e instanceof CalendarError && /video/.test(e.message));
  const dup = slots();
  dup[1].slot = 0;
  assert.throws(() => validateSlots(network, dup), /week 1, slot 0/);
  const noCta = slots().map((s) => ({ ...s, goal: s.goal === 'cta' ? 'product' : s.goal }));
  assert.throws(() => validateSlots(network, noCta), /cta/);
  const short = slots().slice(0, 11);
  assert.throws(() => validateSlots(network, short), /12/);
  const badSlug = slots();
  badSlug[2].slug = 'Not A Slug';
  assert.throws(() => validateSlots(network, badSlug), /slug/);
});

test('renderCalendarMarkdown localizes labels', () => {
  const cal = buildCalendar({ network, slots: slots(), startDate: '2026-11-02', now: '2026-10-26T10:00:00Z' });
  const es = renderCalendarMarkdown(cal, network, { language: 'es', product: 'CVora' });
  assert.match(es, /Calendario de contenido para LinkedIn/);
  assert.match(es, /\| Semana \| Fecha \| Hora \| Formato \| Objetivo \| Tema \| Estado \|/);
  assert.match(es, /Carrusel/);
  assert.match(es, /Pendiente/);
  const en = renderCalendarMarkdown(cal, network, { language: 'en', product: 'CVora' });
  assert.match(en, /LinkedIn content calendar/);
  assert.match(en, /Pending/);
  const xx = renderCalendarMarkdown(cal, network, { language: 'xx', product: 'CVora' });
  assert.match(xx, /Pending/); // falls back to English
});

test('initCalendar writes calendar.json and calendar.md, refuses to overwrite without force', async () => {
  const marketing = await project('es');
  const result = await initCalendar({ marketing, network, slots: slots(), startDate: '2026-11-02' });
  assert.equal(result.posts, 12);
  const json = JSON.parse(await readFile(join(marketing, 'calendar.json'), 'utf8'));
  assert.equal(json.posts.length, 12);
  const md = await readFile(join(marketing, 'calendar.md'), 'utf8');
  assert.match(md, /Topic 1/);
  await assert.rejects(initCalendar({ marketing, network, slots: slots(), startDate: '2026-11-02' }), /already exists/);
  const again = await initCalendar({ marketing, network, slots: slots(), startDate: '2026-11-09', force: true });
  assert.equal(again.startDate, '2026-11-09');
});

test('initCalendar snaps a non-Monday start forward and defaults to next Monday', async () => {
  const marketing = await project('en');
  const snapped = await initCalendar({ marketing, network, slots: slots(), startDate: '2026-11-04' });
  assert.equal(snapped.startDate, '2026-11-09');
  assert.equal(snapped.snapped, true);
  const defaulted = await initCalendar({ marketing, network, slots: slots(), today: '2026-10-26', force: true });
  assert.equal(defaulted.startDate, '2026-11-02');
});

test('setStatus updates one post and re-renders calendar.md; listPosts filters', async () => {
  const marketing = await project('es');
  await initCalendar({ marketing, network, slots: slots(), startDate: '2026-11-02' });
  const updated = await setStatus({ marketing, network, id: '2026-11-03-topic-1', status: 'created' });
  assert.equal(updated.status, 'created');
  const md = await readFile(join(marketing, 'calendar.md'), 'utf8');
  assert.match(md, /Creado/);
  const pending = await listPosts({ marketing, status: 'pending' });
  assert.equal(pending.length, 11);
  const byDate = await listPosts({ marketing, date: '2026-11-04' });
  assert.equal(byDate.length, 1);
  assert.equal(byDate[0].slug, 'topic-2');
  await assert.rejects(setStatus({ marketing, network, id: 'nope', status: 'created' }), /nope/);
  await assert.rejects(setStatus({ marketing, network, id: '2026-11-03-topic-1', status: 'done' }), /status/);
});

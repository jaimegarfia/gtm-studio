#!/usr/bin/env node
// Builds marketing/calendar.html: a self-contained page that shows the four
// weeks as a calendar and, for each post, its text, image thumbnails and
// checklist. Thumbnails are embedded; full-size images and the PDF are linked
// relative to the marketing folder, so the page works when opened from disk.
//
// Usage: node build-calendar-html.mjs --marketing DIR [--out FILE]

import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBrand } from './lib/brand.mjs';
import { labelsFor } from './lib/calendar.mjs';
import { escapeHtml } from './lib/template.mjs';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'calendar-page.html');

/** Very small Markdown to HTML conversion for checklists: headings, lists, bold, code, paragraphs. */
export function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;
  let para = [];
  const inline = (text) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        list = kind;
        out.push(`<${kind}>`);
      }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      if (list) closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function listMatching(dir, re) {
  try {
    return (await readdir(dir)).filter((n) => re.test(n)).sort();
  } catch {
    return [];
  }
}

function toRelUrl(rel) {
  return rel.split('\\').join('/').split('/').map(encodeURIComponent).join('/');
}

/**
 * Builds the page.
 * @returns {Promise<{ calendarHtml: string, posts: number, created: number, pending: number, bytes: number }>}
 */
export async function buildCalendarHtml({ marketing, out }) {
  marketing = resolve(marketing);
  const calendarPath = join(marketing, 'calendar.json');
  if (!existsSync(calendarPath)) throw new Error(`Cannot find ${calendarPath}. Run /gtm-studio:plan first.`);
  const calendar = JSON.parse(await readFile(calendarPath, 'utf8'));
  const { tokens } = await readBrand(join(marketing, 'brand.md'));
  const networkPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'networks', calendar.network || 'linkedin', 'network.json');
  const network = existsSync(networkPath) ? JSON.parse(await readFile(networkPath, 'utf8')) : { name: calendar.network || 'LinkedIn' };
  const labels = labelsFor(tokens.language);

  const posts = [];
  for (const p of calendar.posts) {
    const dir = join(marketing, p.dir);
    const text = await readIfExists(join(dir, 'post.md'));
    const checklist = await readIfExists(join(dir, 'checklist.md'));
    const slideFiles = await listMatching(dir, /^slide-\d+\.png$/);
    const thumbFiles = await listMatching(join(dir, 'thumbs'), /^slide-\d+\.jpg$/);
    const thumbs = [];
    for (const name of thumbFiles) {
      const buf = await readFile(join(dir, 'thumbs', name));
      thumbs.push({ name, src: `data:image/jpeg;base64,${buf.toString('base64')}` });
    }
    const pdf = existsSync(join(dir, 'carousel.pdf')) ? `${toRelUrl(p.dir)}/carousel.pdf` : null;
    posts.push({
      id: p.id,
      date: p.date,
      time: p.time,
      week: p.week,
      format: p.format,
      goal: p.goal,
      topic: p.topic,
      status: p.status,
      dir: p.dir,
      text: p.status === 'created' ? text : null,
      checklistHtml: p.status === 'created' && checklist ? markdownToHtml(checklist) : null,
      images: p.status === 'created' ? slideFiles.map((n) => `${toRelUrl(p.dir)}/${n}`) : [],
      thumbs: p.status === 'created' ? thumbs : [],
      pdf: p.status === 'created' ? pdf : null,
    });
  }

  const data = { product: tokens.product, network: network.name, startDate: calendar.startDate, timezone: calendar.timezone || tokens.timezone || null, generatedAt: new Date().toISOString(), labels, posts };
  const json = JSON.stringify(data).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const title = `${labels.title.replace('{network}', network.name)} — ${tokens.product}`;
  const template = await readFile(TEMPLATE, 'utf8');
  const html = template
    .split('__GTM_LANG__').join(escapeHtml(tokens.language))
    .split('__GTM_TITLE__').join(escapeHtml(title))
    .split('__GTM_SUBTITLE__').join(escapeHtml(labels.page.subtitle))
    .split('__GTM_CLOSE__').join(escapeHtml(labels.page.close))
    .split('__GTM_ACCENT__').join(escapeHtml(tokens.colors.primary))
    .split('__GTM_ACCENT_INK__').join(escapeHtml(contrastInk(tokens.colors.primary)))
    .split('__GTM_DATA__').join(json);
  const outPath = resolve(out || join(marketing, 'calendar.html'));
  await writeFile(outPath, html, 'utf8');
  const created = posts.filter((p) => p.status === 'created').length;
  return { calendarHtml: outPath, posts: posts.length, created, pending: posts.length - created, bytes: Buffer.byteLength(html) };
}

function contrastInk(color) {
  // Lazy import avoided: duplicate the small luminance rule for hex colors, white otherwise.
  const m = String(color).match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? '#111111' : '#ffffff';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.marketing) {
    console.log('Usage: node build-calendar-html.mjs --marketing DIR [--out FILE]');
    process.exit(args.help ? 0 : 1);
  }
  buildCalendarHtml({ marketing: args.marketing, out: args.out })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(err.name === 'BrandTokensError' ? err.message : err.message || err.stack);
      process.exit(1);
    });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCalendarHtml, markdownToHtml } from '../scripts/build-calendar-html.mjs';

test('markdownToHtml handles headings, lists, bold, code and paragraphs, escaping HTML', () => {
  const html = markdownToHtml('# Cuándo\n\nMartes **10:00**, hora local.\n\n## Pasos\n\n1. Abre `post.md`\n2. Pega <b>el</b> texto\n\n- [ ] Comentario\n- Hashtags\n');
  assert.match(html, /<h1>Cuándo<\/h1>/);
  assert.match(html, /<p>Martes <strong>10:00<\/strong>, hora local.<\/p>/);
  assert.match(html, /<ol>\n<li>Abre <code>post.md<\/code><\/li>\n<li>Pega &lt;b&gt;el&lt;\/b&gt; texto<\/li>\n<\/ol>/);
  assert.match(html, /<ul>\n<li>Comentario<\/li>\n<li>Hashtags<\/li>\n<\/ul>/);
});

test('builds a self-contained page with embedded thumbnails, escaped text and relative links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gtm-html-'));
  const marketing = join(root, 'marketing');
  const created = join(marketing, 'posts', '2026-11-10-dos-columnas');
  await mkdir(join(created, 'thumbs'), { recursive: true });
  await mkdir(join(marketing, 'posts', '2026-11-11-ats'), { recursive: true });
  await writeFile(join(marketing, 'brand.md'), '# X\n\n<!-- gtm-studio:tokens -->\n```json\n{"product":"CVora","language":"es","colors":{"primary":"#c2410c"}}\n```\n');
  await writeFile(
    join(marketing, 'calendar.json'),
    JSON.stringify({
      version: 1,
      network: 'linkedin',
      startDate: '2026-11-09',
      posts: [
        { id: '2026-11-10-dos-columnas', date: '2026-11-10', time: '08:30', week: 1, format: 'carousel', goal: 'problem', topic: 'Dos columnas', angle: '', slug: 'dos-columnas', status: 'created', dir: 'posts/2026-11-10-dos-columnas' },
        { id: '2026-11-11-ats', date: '2026-11-11', time: '08:30', week: 1, format: 'text', goal: 'product', topic: 'Qué ve un ATS', angle: '', slug: 'ats', status: 'pending', dir: 'posts/2026-11-11-ats' },
      ],
    }),
  );
  await writeFile(join(created, 'post.md'), 'Tu CV no llega a un humano.\nLlega a un filtro.\n\n</script><img src=x onerror=alert(1)>\n\n#cv #ats #empleo');
  await writeFile(join(created, 'checklist.md'), '# Cuándo\n\nMartes 10 de noviembre, 08:30.\n\n## Primer comentario\n\nEnlace: https://www.cvora.net/es\n');
  await writeFile(join(created, 'slide-01.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(join(created, 'slide-02.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(join(created, 'thumbs', 'slide-01.jpg'), Buffer.from('ffd8ffe0', 'hex'));
  await writeFile(join(created, 'thumbs', 'slide-02.jpg'), Buffer.from('ffd8ffe0', 'hex'));
  await writeFile(join(created, 'carousel.pdf'), '%PDF-1.4');

  const result = await buildCalendarHtml({ marketing });
  assert.equal(result.posts, 2);
  assert.equal(result.created, 1);
  assert.equal(result.pending, 1);
  const html = await readFile(join(marketing, 'calendar.html'), 'utf8');
  assert.match(html, /<html lang="es">/);
  assert.match(html, /Calendario de contenido para LinkedIn — CVora/);
  assert.match(html, /data:image\/jpeg;base64,\/9j\/4A/);
  assert.match(html, /posts\/2026-11-10-dos-columnas\/slide-01\.png/);
  assert.match(html, /posts\/2026-11-10-dos-columnas\/carousel\.pdf/);
  assert.ok(!/<\/script><img/.test(html), 'post text must not break out of the data script');
  assert.match(html, /<\\\/script>/);
  assert.match(html, /"Qué ve un ATS"/);
  assert.match(html, /--accent: #c2410c/);
  assert.ok(!html.includes('__GTM_'), 'no placeholders left');
});

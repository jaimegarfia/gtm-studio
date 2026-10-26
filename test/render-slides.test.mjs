import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeBrowser } from '../scripts/lib/browser.mjs';
import { renderPost } from '../scripts/render-slides.mjs';
import { contrastColor } from '../scripts/lib/brand.mjs';

const probe = await probeBrowser();
const skip = probe.ok ? false : `no browser available: ${probe.error.split('\n')[0]}`;

function pngSize(buf) {
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'gtm-render-'));
  await mkdir(join(root, 'brand'), { recursive: true });
  await writeFile(join(root, 'brand', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><rect width="200" height="40" fill="#fff"/><text x="10" y="28" font-size="24">CVora</text></svg>');
  await mkdir(join(root, 'marketing', 'posts', '2026-11-03-demo'), { recursive: true });
  await writeFile(
    join(root, 'marketing', 'brand.md'),
    `# CVora\n\n<!-- gtm-studio:tokens -->\n\`\`\`json\n${JSON.stringify({
      product: 'CVora',
      language: 'es',
      website: 'https://cvora.net',
      colors: { primary: '#c2410c', background: '#f7f5f0', surface: '#efece5', text: '#161513', muted: '#6f6a62' },
      fonts: { heading: 'Fraunces', body: 'Inter', source: 'google' },
      logo: { path: 'brand/logo.svg' },
    })}\n\`\`\`\n`,
  );
  return root;
}

test('contrastColor picks readable text', () => {
  assert.equal(contrastColor('#c2410c'), '#ffffff');
  assert.equal(contrastColor('#f7f5f0'), '#111111');
  assert.equal(contrastColor('rgb(255, 255, 255)'), '#111111');
  assert.equal(contrastColor('hsl(0, 0%, 10%)'), '#ffffff');
  assert.equal(contrastColor('oklch(0.7 0.1 200)'), '#ffffff');
});

test('renders a carousel to PNGs, thumbnails and a PDF, with a fallback for a missing screenshot', { skip }, async () => {
  const root = await project();
  const postDir = join(root, 'marketing', 'posts', '2026-11-03-demo');
  await writeFile(
    join(postDir, 'slides.json'),
    JSON.stringify({
      format: 'carousel',
      slides: [
        { template: 'cover', kicker: 'CV', title: 'Por qué los reclutadores descartan tu CV en 6 segundos', subtitle: 'Y qué cambiar hoy', swipeLabel: 'Desliza' },
        { template: 'point', number: '01', title: 'Dos columnas', body: 'Los ATS leen de izquierda a derecha. Tu experiencia acaba mezclada con tus hobbies.' },
        { template: 'point', number: '02', title: 'Sin números', bullets: ['Gestioné un equipo', 'Gestioné un equipo de 6 personas', 'Subí la retención un 18 %'] },
        { template: 'screenshot', title: 'Así lo ve CVora', image: 'screens/missing.png', caption: 'Análisis en tiempo real', fallbackBody: 'CVora marca cada bloque que un ATS no puede leer.' },
        { template: 'cta', title: 'Prueba CVora gratis', body: 'Sube tu CV y mira el informe en un minuto.', url: 'cvora.net', button: 'Empezar' },
      ],
    }),
  );
  const result = await renderPost({ postDir, offline: true });
  assert.equal(result.slides, 5);
  assert.equal(result.files.length, 5);
  for (const file of result.files) {
    const { width, height } = pngSize(await readFile(file));
    assert.deepEqual({ width, height }, { width: 1080, height: 1350 });
  }
  assert.equal(result.thumbs.length, 5);
  assert.ok((await stat(result.thumbs[0])).size > 0);
  assert.ok(result.pdf && result.pdf.endsWith('carousel.pdf'));
  assert.equal((await readFile(result.pdf)).toString('ascii', 0, 4), '%PDF');
  assert.ok(result.warnings.some((w) => /image not found/.test(w)));
  assert.ok(!result.warnings.some((w) => /Logo not found/.test(w)));
});

test('re-rendering with fewer slides removes stale files; screenshot format has no PDF', { skip }, async () => {
  const root = await project();
  const postDir = join(root, 'marketing', 'posts', '2026-11-03-demo');
  const five = { format: 'carousel', slides: Array.from({ length: 5 }, (_, i) => ({ template: 'point', title: `Slide ${i + 1}` })) };
  await writeFile(join(postDir, 'slides.json'), JSON.stringify(five));
  await renderPost({ postDir, offline: true });
  assert.ok(existsSync(join(postDir, 'slide-05.png')));

  await mkdir(join(root, 'marketing', 'screens'), { recursive: true });
  await writeFile(join(root, 'marketing', 'screens', 'home-desktop.png'), await readFile(join(postDir, 'slide-01.png')));
  const one = { format: 'screenshot', slides: [{ template: 'screenshot', title: 'La pantalla principal', image: 'screens/home-desktop.png', frame: 'browser', caption: 'Informe ATS' }] };
  await writeFile(join(postDir, 'slides.json'), JSON.stringify(one));
  const result = await renderPost({ postDir, offline: true });
  assert.equal(result.files.length, 1);
  assert.equal(result.pdf, null);
  assert.ok(!existsSync(join(postDir, 'slide-02.png')));
  assert.ok(!existsSync(join(postDir, 'slide-05.png')));
  assert.ok(!existsSync(join(postDir, 'carousel.pdf')));
  assert.deepEqual(result.warnings, []);
});

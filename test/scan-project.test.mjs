import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scanProject } from '../scripts/scan-project.mjs';

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'gtm-scan-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

test('monorepo: finds the Next.js app in frontend/, Tailwind v4 tokens, i18n and logos', async () => {
  const root = await fixture({
    'README.md': '# Here are your Instructions\n\nCVora: crea tu currículum con inteligencia artificial y consigue más entrevistas. Es gratis para empezar.\n\nhttps://cvora.net\n',
    'frontend/package.json': {
      name: 'cvora-web',
      scripts: { dev: 'next dev', build: 'next build' },
      dependencies: { next: '15.0.0', react: '19.0.0', 'next-intl': '4.0.0', tailwindcss: '4.0.0' },
    },
    'frontend/package-lock.json': '{}',
    'frontend/src/app/globals.css': '@import "tailwindcss";\n@theme {\n  --color-primary: #123456;\n  --color-accent: oklch(0.7 0.1 200);\n  --font-sans: "Inter", sans-serif;\n}\n',
    'frontend/src/app/[locale]/page.tsx': 'export default function Page() { return <main>Hero</main>; }',
    'frontend/src/app/[locale]/pricing/page.tsx': 'export default function Pricing() { return null; }',
    'frontend/src/app/[locale]/app/page.tsx': 'export default function LoggedInApp() { return null; }',
    'frontend/src/app/[locale]/[...rest]/page.tsx': 'export default function NotFound() { return null; }',
    'frontend/src/app/(auth)/login/page.tsx': 'export default function Login() { return null; }',
    'frontend/src/i18n/routing.ts': "export const routing = { locales: ['es', 'en'], defaultLocale: 'es' };",
    'frontend/messages/es.json': { home: { title: 'Hola' } },
    'frontend/messages/en.json': { home: { title: 'Hello' } },
    'frontend/node_modules/next/package.json': { name: 'next' },
    'brand/cvora-wordmark.svg': '<svg/>',
    'brand/cvora-mark.svg': '<svg/>',
    'backend/package.json': { name: 'api', scripts: { start: 'node server.js' }, dependencies: { express: '4.0.0' } },
  });
  const result = await scanProject(root);

  assert.equal(result.app.dir, 'frontend');
  assert.equal(result.app.framework, 'next');
  assert.equal(result.app.devCommand, 'npm run dev');
  assert.equal(result.app.port, 3000);
  assert.equal(result.app.packageManager, 'npm');

  assert.equal(result.language, 'es');
  assert.equal(result.i18n.defaultLocale, 'es');
  assert.deepEqual(result.i18n.locales, ['en', 'es']);
  assert.ok(result.i18n.messages.some((p) => p.endsWith('messages/es.json')));

  assert.equal(result.design.source, 'tailwind-v4');
  const primary = result.design.colors.find((c) => c.name === 'primary');
  assert.equal(primary.value, '#123456');
  assert.ok(result.design.fonts.some((f) => f.family === 'Inter'));

  assert.ok(result.logos.includes('brand/cvora-wordmark.svg'));
  assert.ok(result.logos.includes('brand/cvora-mark.svg'));
  assert.ok(result.landing.includes('frontend/src/app/[locale]/page.tsx'));
  assert.ok(!result.landing.some((p) => p.includes('[locale]/app/')), 'logged-in area is not landing copy');
  assert.ok(!result.landing.some((p) => p.includes('[...rest]')), 'catch-all routes are not landing copy');
  assert.ok(!result.landing.some((p) => p.includes('(auth)')), 'auth pages are not landing copy');
  assert.ok(result.pricing.some((p) => p.includes('pricing')));
  assert.equal(result.app.portArg, '-p');
  assert.ok(!result.productNames.includes('Here are your Instructions'), 'boilerplate README title is ignored');
  assert.ok(result.productNames.includes('cvora-web'));
  assert.equal(result.readme, 'README.md');
  assert.ok(result.urls.includes('https://cvora.net'));
  assert.ok(!JSON.stringify(result).includes('node_modules'));
});

test('single Vite app: Tailwind v3 config colors, html lang and port override', async () => {
  const root = await fixture({
    'package.json': {
      name: 'tiny-app',
      scripts: { dev: 'vite --port 4321', build: 'vite build' },
      dependencies: { react: '18.0.0' },
      devDependencies: { vite: '5.0.0', tailwindcss: '3.4.0' },
    },
    'pnpm-lock.yaml': '',
    'index.html': '<!doctype html><html lang="en"><head><title>Tiny App</title></head><body></body></html>',
    'tailwind.config.js': "module.exports = { theme: { extend: { colors: { brand: '#ff6600', ink: { DEFAULT: '#222222' } }, fontFamily: { sans: ['Space Grotesk', 'sans-serif'] } } } };",
    'src/App.tsx': 'export default function App() { return <h1>Tiny</h1>; }',
    'public/logo.png': 'png',
  });
  const result = await scanProject(root);
  assert.equal(result.app.dir, '.');
  assert.equal(result.app.framework, 'vite');
  assert.equal(result.app.devCommand, 'pnpm run dev');
  assert.equal(result.app.port, 4321);
  assert.equal(result.language, 'en');
  assert.equal(result.design.source, 'tailwind-v3');
  assert.ok(result.design.colors.some((c) => c.name === 'brand' && c.value === '#ff6600'));
  assert.ok(result.design.colors.some((c) => c.name === 'ink' && c.value === '#222222'));
  assert.ok(result.design.fonts.some((f) => f.family === 'Space Grotesk'));
  assert.ok(result.logos.includes('public/logo.png'));
  assert.deepEqual(result.productNames.slice(0, 2), ['Tiny App', 'tiny-app']);
});

test('plain CSS variables and no package.json still produce a usable result', async () => {
  const root = await fixture({
    'README.md': '# Widget\n\nThe fastest way to build widgets for your team.\n',
    'styles/main.css': ':root {\n  --primary: #abcdef;\n  --bg: rgb(250, 250, 250);\n  --font-body: "Lato", sans-serif;\n}\n',
  });
  const result = await scanProject(root);
  assert.equal(result.app, null);
  assert.equal(result.design.source, 'css-vars');
  assert.ok(result.design.colors.some((c) => c.name === 'primary' && c.value === '#abcdef'));
  assert.ok(result.design.fonts.some((f) => f.family === 'Lato'));
  assert.equal(result.language, 'en');
});

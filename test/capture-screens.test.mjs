import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeBrowser } from '../scripts/lib/browser.mjs';
import { captureScreens, routeSlug, normalizeRoute, parseRouteSpecs } from '../scripts/capture-screens.mjs';

const probe = await probeBrowser();
const skip = probe.ok ? false : `no browser available: ${probe.error.split('\n')[0]}`;

const PAGE = (title) => `<!doctype html><html><head><title>${title}</title></head><body style="margin:0;font:48px sans-serif"><button id="c" onclick="this.remove()">Aceptar</button><h1>${title}</h1></body></html>`;

function freePort() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

test('routeSlug', () => {
  assert.equal(routeSlug('/'), 'home');
  assert.equal(routeSlug('/pricing'), 'pricing');
  assert.equal(routeSlug('/es/app?x=1'), 'es-app');
});

test('normalizeRoute accepts bare names and undoes Git Bash path conversion', () => {
  assert.equal(normalizeRoute('pricing'), '/pricing');
  assert.equal(normalizeRoute('/pricing'), '/pricing');
  assert.equal(normalizeRoute('home'), '/');
  assert.equal(normalizeRoute('.'), '/');
  assert.equal(normalizeRoute(''), '/');
  assert.equal(normalizeRoute('C:/Program Files/Git/'), '/');
  assert.equal(normalizeRoute('/C:/Program Files/Git/'), '/');
  assert.equal(normalizeRoute('es/app'), '/es/app');
});

test('parseRouteSpecs understands route@selector strings and objects', () => {
  assert.deepEqual(parseRouteSpecs(['home', 'pricing@#plans', { route: 'check', selector: 'section.demo', name: 'Demo block' }, 'pricing@#plans']), [
    { route: '/', selector: null, name: 'home' },
    { route: '/pricing', selector: '#plans', name: 'pricing-plans' },
    { route: '/check', selector: 'section.demo', name: 'demo-block' },
  ]);
  assert.deepEqual(parseRouteSpecs([]), [{ route: '/', selector: null, name: 'home' }]);
});

test('captures routes and selected elements on a running server and writes a manifest with relative files', { skip }, async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(PAGE(req.url === '/pricing' ? 'Pricing' : 'Home'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const out = await mkdtemp(join(tmpdir(), 'gtm-cap-'));
  try {
    const manifest = await captureScreens({ url: `http://127.0.0.1:${port}`, out, routes: ['/', '/pricing', 'pricing@h1'], devices: ['desktop'], settle: 0, locale: 'es' });
    assert.equal(manifest.screens.length, 3);
    assert.ok(existsSync(join(out, 'home-desktop.png')));
    assert.ok(existsSync(join(out, 'pricing-desktop.png')));
    assert.ok(existsSync(join(out, 'pricing-h1-desktop.png')));
    const saved = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    assert.equal(saved.dir, out);
    assert.equal(saved.locale, 'es');
    assert.equal(saved.screens[0].file, 'home-desktop.png');
    assert.equal(saved.screens[0].width, 2880);
    assert.equal(saved.screens[1].route, '/pricing');
    assert.equal(saved.screens[2].selector, 'h1');
    assert.ok(saved.screens[2].height < 400, 'element shot is the h1, not the whole viewport');
  } finally {
    server.close();
  }
});

test('starts the app with --start, waits for it and stops it afterwards', { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-cap-srv-'));
  const port = await freePort();
  await writeFile(
    join(dir, 'server.mjs'),
    `import { createServer } from 'node:http';
setTimeout(() => {
  createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<h1>Up</h1>'); }).listen(${port}, '127.0.0.1');
}, 1200);
setInterval(() => {}, 1000);`,
  );
  const out = join(dir, 'screens');
  const manifest = await captureScreens({ url: `http://127.0.0.1:${port}`, out, routes: ['/'], devices: ['mobile'], start: 'node server.mjs', cwd: dir, timeout: 30000, settle: 0 });
  assert.equal(manifest.screens.length, 1);
  assert.ok(existsSync(join(out, 'home-mobile.png')));
  assert.ok(existsSync(join(out, 'dev-server.log')));
  await new Promise((r) => setTimeout(r, 1000));
  const free = await new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
  });
  assert.equal(free, true, 'the dev server port should be free again');
});

function serveTitle(title) {
  return createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`);
  });
}

const APP_SCRIPT = `import { createServer } from 'node:http';
const i = process.argv.indexOf('--port');
const port = Number(i !== -1 ? process.argv[i + 1] : process.env.PORT);
createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>CVora</title><h1>CVora</h1>'); }).listen(port, '127.0.0.1');
setInterval(() => {}, 1000);`;

test('a foreign app on the port is never captured: the product starts on a free port instead', { skip }, async () => {
  const foreign = serveTitle('kaisub · Reserva inmersiones');
  await new Promise((r) => foreign.listen(0, '127.0.0.1', r));
  const { port } = foreign.address();
  const dir = await mkdtemp(join(tmpdir(), 'gtm-cap-foreign-'));
  await writeFile(join(dir, 'server.mjs'), APP_SCRIPT);
  try {
    const manifest = await captureScreens({
      url: `http://127.0.0.1:${port}`,
      out: join(dir, 'screens'),
      routes: ['/'],
      devices: ['desktop'],
      start: 'node server.mjs',
      cwd: dir,
      expect: 'CVora',
      portArg: '--port',
      timeout: 30000,
      settle: 0,
    });
    assert.equal(manifest.requestedUrl, `http://127.0.0.1:${port}`);
    assert.notEqual(manifest.url, manifest.requestedUrl, 'captured from a different port');
    assert.equal(manifest.screens.length, 1);
    assert.ok(manifest.warnings.some((w) => /kaisub/.test(w) && /free port/.test(w)));
  } finally {
    foreign.close();
  }
});

test('reuses the running server when it serves the expected product', { skip }, async () => {
  const own = serveTitle('CVora — tu CV');
  await new Promise((r) => own.listen(0, '127.0.0.1', r));
  const { port } = own.address();
  const out = await mkdtemp(join(tmpdir(), 'gtm-cap-reuse-'));
  try {
    const manifest = await captureScreens({ url: `http://127.0.0.1:${port}`, out, routes: ['/'], devices: ['desktop'], start: 'node this-must-not-run.mjs', cwd: out, expect: 'cvora', settle: 0 });
    assert.equal(manifest.url, `http://127.0.0.1:${port}`);
    assert.equal(manifest.screens.length, 1);
    assert.deepEqual(manifest.warnings, []);
  } finally {
    own.close();
  }
});

test('refuses to guess when the port is busy and no --expect was given', async () => {
  const other = serveTitle('Something else');
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const { port } = other.address();
  const out = await mkdtemp(join(tmpdir(), 'gtm-cap-busy-'));
  try {
    await assert.rejects(captureScreens({ url: `http://127.0.0.1:${port}`, out, routes: ['/'], start: 'node x.mjs', cwd: out }), /--expect/);
  } finally {
    other.close();
  }
});

test('fails clearly when nothing answers and no --start was given', async () => {
  const port = await freePort();
  const out = await mkdtemp(join(tmpdir(), 'gtm-cap-none-'));
  await assert.rejects(captureScreens({ url: `http://127.0.0.1:${port}`, out, routes: ['/'] }), /Nothing answers/);
});

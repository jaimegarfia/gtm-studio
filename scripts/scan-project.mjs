#!/usr/bin/env node
// Scans a product repository and prints a JSON summary of what the code says
// about the product: where the app lives and how to start it, the README and
// landing-page files worth reading, pricing files, i18n locales, the product
// language, design tokens (Tailwind v3/v4, CSS variables, Google Fonts), logo
// candidates, public URLs and product-name candidates.
//
// Usage: node scan-project.mjs [--root DIR] [--json]
//
// It only reads files; it never writes to the project.

import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILES = 15000;
const MAX_DEPTH = 7;
const MAX_READ_BYTES = 300 * 1024;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.output', '.turbo', '.cache',
  'dist', 'build', 'out', 'coverage', 'vendor', 'target', '.venv', 'venv', '__pycache__',
  '.idea', '.vscode', 'storybook-static', '.vercel', '.netlify', 'tmp', '.tmp',
]);
// Our own output inside the user's marketing folder.
const SKIP_PATH_PREFIXES = ['marketing/posts/', 'marketing/screens/'];

// portArg: the flag that moves the dev server to another port when the default
// one is taken (appended as `npm run dev -- <portArg> <port>`); null means the
// PORT environment variable is enough.
const FRAMEWORKS = [
  { dep: 'next', id: 'next', port: 3000, frontend: true, portArg: '-p' },
  { dep: 'nuxt', id: 'nuxt', port: 3000, frontend: true, portArg: '--port' },
  { dep: '@sveltejs/kit', id: 'sveltekit', port: 5173, frontend: true, portArg: '--port' },
  { dep: 'astro', id: 'astro', port: 4321, frontend: true, portArg: '--port' },
  { dep: '@remix-run/dev', id: 'remix', port: 5173, frontend: true, portArg: '--port' },
  { dep: 'gatsby', id: 'gatsby', port: 8000, frontend: true, portArg: '-p' },
  { dep: '@docusaurus/core', id: 'docusaurus', port: 3000, frontend: true, portArg: '--port' },
  { dep: '@angular/core', id: 'angular', port: 4200, frontend: true, portArg: '--port' },
  { dep: 'react-scripts', id: 'cra', port: 3000, frontend: true, portArg: null },
  { dep: '@vue/cli-service', id: 'vue-cli', port: 8080, frontend: true, portArg: '--port' },
  { dep: 'vite', id: 'vite', port: 5173, frontend: true, portArg: '--port' },
  { dep: '@nestjs/core', id: 'nest', port: 3000, frontend: false },
  { dep: 'fastify', id: 'fastify', port: 3000, frontend: false },
  { dep: 'express', id: 'express', port: 3000, frontend: false },
  { dep: 'hono', id: 'hono', port: 3000, frontend: false },
  { dep: 'koa', id: 'koa', port: 3000, frontend: false },
];

const FRONTEND_DIR_NAMES = ['frontend', 'web', 'app', 'client', 'site', 'www', 'landing', 'website'];

const STOPWORDS = {
  es: ['el', 'la', 'los', 'las', 'de', 'para', 'con', 'una', 'que', 'es', 'tu', 'más', 'del', 'por', 'y'],
  en: ['the', 'and', 'for', 'with', 'your', 'is', 'to', 'of', 'a', 'in', 'you', 'it'],
  pt: ['os', 'as', 'para', 'com', 'uma', 'que', 'é', 'seu', 'do', 'da', 'não', 'você', 'em'],
  fr: ['le', 'la', 'les', 'des', 'pour', 'avec', 'une', 'est', 'vous', 'et', 'dans', 'votre'],
  de: ['der', 'die', 'das', 'und', 'für', 'mit', 'ist', 'eine', 'sie', 'nicht', 'ihr', 'zu'],
  it: ['il', 'gli', 'per', 'con', 'una', 'è', 'che', 'di', 'non', 'della', 'tuo', 'più'],
};

const COLOR_VALUE = /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl|oklch|oklab|lab|lch|hwb)a?\([^)]*\)|color\([^)]*\))$/;
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const IGNORED_URL_HOSTS = /(github\.com|githubusercontent|npmjs\.com|localhost|127\.0\.0\.1|0\.0\.0\.0|shields\.io|badge|googleapis|gstatic|fonts\.|unpkg|jsdelivr|cdn\.|example\.com|twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|schema\.org|w3\.org|nodejs\.org|reactjs\.org|react\.dev|nextjs\.org|vitejs\.dev|vuejs\.org|tailwindcss\.com|opensource\.org|choosealicense|vercel\.com|netlify\.com|stripe\.com|posthog|sentry|google\.com|apple\.com|microsoft\.com|mozilla\.org|developer\.|docs\.|wikipedia|bsky\.app|googletagmanager|vercel\.sh|cloudflare|hotjar|plausible|umami|analytics)/i;

/** Walks the tree and returns POSIX-style paths relative to root. */
async function listFiles(root) {
  const files = [];
  let truncated = false;
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(root, abs));
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.git')) continue;
        if (SKIP_PATH_PREFIXES.some((p) => (rel + '/').startsWith(p))) continue;
        await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  await walk(root, 0);
  return { files, truncated };
}

function toPosix(p) {
  return p.split('\\').join('/');
}

function depthOf(rel) {
  return rel.split('/').length - 1;
}

async function readText(root, rel) {
  try {
    const buf = await readFile(join(root, rel));
    return buf.subarray(0, MAX_READ_BYTES).toString('utf8');
  } catch {
    return '';
  }
}

async function readJson(root, rel) {
  try {
    return JSON.parse(await readText(root, rel));
  } catch {
    return null;
  }
}

function dirOf(rel) {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '.' : rel.slice(0, i);
}

function inDir(rel, dir) {
  return dir === '.' ? true : rel === dir || rel.startsWith(dir + '/');
}

/* ---------- packages and app ---------- */

function detectPackageManager(files, dir) {
  for (const d of [dir, '.']) {
    const has = (name) => files.includes(d === '.' ? name : `${d}/${name}`);
    if (has('pnpm-lock.yaml')) return 'pnpm';
    if (has('yarn.lock')) return 'yarn';
    if (has('bun.lock') || has('bun.lockb')) return 'bun';
    if (has('package-lock.json') || has('npm-shrinkwrap.json')) return 'npm';
  }
  return 'npm';
}

function detectFramework(pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const fw of FRAMEWORKS) {
    if (deps[fw.dep]) return fw;
  }
  return null;
}

function portFromScript(script) {
  if (!script) return null;
  const m = script.match(/(?:--port|-p)[= ]+(\d{2,5})/) || script.match(/\bPORT=(\d{2,5})/);
  return m ? Number(m[1]) : null;
}

async function analyzePackages(root, files) {
  const pkgFiles = files.filter((f) => basename(f) === 'package.json' && depthOf(f) <= 3);
  const packages = [];
  for (const rel of pkgFiles) {
    const pkg = await readJson(root, rel);
    if (!pkg || typeof pkg !== 'object') continue;
    const dir = dirOf(rel);
    const scripts = pkg.scripts || {};
    const fw = detectFramework(pkg);
    const devScriptName = ['dev', 'start', 'serve', 'preview'].find((s) => scripts[s]);
    const pm = detectPackageManager(files, dir);
    const devCommand = devScriptName ? `${pm} run ${devScriptName}` : null;
    const port = portFromScript(scripts[devScriptName]) || fw?.port || null;
    packages.push({
      dir,
      name: pkg.name || null,
      framework: fw?.id || null,
      frontend: Boolean(fw?.frontend),
      scripts: { dev: scripts.dev || null, start: scripts.start || null, build: scripts.build || null },
      devCommand,
      port,
      portArg: fw && fw.frontend ? fw.portArg : null,
      packageManager: pm,
    });
  }
  return packages;
}

function pickApp(packages) {
  const candidates = packages.filter((p) => p.frontend && p.devCommand);
  if (candidates.length === 0) return null;
  const score = (p) => {
    let s = 0;
    if (p.dir === '.') s += 3;
    if (FRONTEND_DIR_NAMES.includes(basename(p.dir).toLowerCase())) s += 2;
    if (p.framework !== 'vite') s += 1; // meta-frameworks usually own the landing page
    return s;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

/* ---------- docs, landing, pricing ---------- */

function findReadme(files) {
  return files.find((f) => /^readme(\.md|\.mdx|\.txt)?$/i.test(f)) || null;
}

function findDocs(files) {
  return files.filter((f) => /^docs?\/[^/]+\.mdx?$/i.test(f)).slice(0, 10);
}

const LANDING_PATTERNS = [
  /(^|\/)(src\/)?app\/((\([^)]+\)|\[[^\]]+\])\/)*page\.(tsx|jsx|js|ts|mdx)$/, // next app router root page
  /(^|\/)(src\/)?pages\/index\.(tsx|jsx|js|ts|vue|astro|mdx)$/,
  /(^|\/)src\/App\.(tsx|jsx|vue|svelte)$/,
  /(^|\/)src\/routes\/\+page\.svelte$/,
  /(^|\/)app\.vue$/,
  /(^|\/)src\/app\/app\.component\.html$/,
  /(^|\/)index\.html$/,
  /(^|\/)(src\/|app\/)?(components|sections|modules|features)\/.*(hero|landing|feature|benefit|testimonial|faq|cta|pricing|how-?it-?works)[^/]*\.(tsx|jsx|vue|svelte|astro|ts|js|html)$/i,
];

// Segments that mark a logged-in or auth area rather than public marketing
// pages. Checked after the router root (`app/` or `pages/`) is stripped, so
// Next's own `app/` directory is not mistaken for one.
const PRIVATE_SEGMENT = /(^|\/)(app|dashboard|admin|account|settings|profile|login|signin|signup|register|auth|onboarding|\(auth\)|\(app\)|\(dashboard\)|\(protected\))(\/|$)/i;
const CATCH_ALL = /\[\.\.\.|\[\[\.\.\./;

function isPublicPage(file) {
  if (CATCH_ALL.test(file)) return false;
  // Lazy prefix: strip up to the FIRST router root, so `app/[locale]/app/page.tsx`
  // keeps its inner `app` segment for the private-area check.
  const rest = file.replace(/^(?:.*?\/)?(?:src\/)?(?:app|pages)\//, '');
  if (rest === file) return true; // not inside a router directory
  const dir = rest.replace(/\/[^/]*$/, '');
  return !PRIVATE_SEGMENT.test(dir);
}

function findLanding(files, appDir) {
  const scoped = appDir ? files.filter((f) => inDir(f, appDir)) : files;
  const hits = scoped.filter((f) => LANDING_PATTERNS.some((re) => re.test(f)) && !/\.(test|spec|stories)\./.test(f) && isPublicPage(f));
  return hits.sort((a, b) => a.length - b.length).slice(0, 15);
}

function findPricing(files, appDir) {
  const scoped = appDir ? files.filter((f) => inDir(f, appDir)) : files;
  return scoped
    .filter((f) => /(pricing|precios|prices|plans|planes|subscri|checkout|billing|tarif)/i.test(f))
    .filter((f) => /\.(tsx|jsx|ts|js|vue|svelte|astro|md|mdx|json|html|py)$/i.test(f))
    .filter((f) => !/\.(test|spec|stories)\./.test(f))
    .sort((a, b) => a.length - b.length)
    .slice(0, 10);
}

/* ---------- i18n and language ---------- */

const LOCALE_RE = /^[a-z]{2}(?:[-_][A-Za-z]{2,4})?$/;
const I18N_DIR_NAMES = ['messages', 'locales', 'i18n', 'lang', 'langs', 'translations'];

async function analyzeI18n(root, files) {
  const dirs = new Set();
  const messages = [];
  for (const f of files) {
    const m = f.match(/(^|\/)(messages|locales|i18n|lang|langs|translations|public\/locales)\/(.+)$/);
    if (!m) continue;
    if (!/\.(json|ya?ml)$/i.test(f)) continue;
    const dir = f.slice(0, m.index + m[1].length + m[2].length);
    dirs.add(dir);
    messages.push(f);
  }
  const locales = new Set();
  for (const f of messages) {
    const parts = f.split('/');
    const stem = basename(f).replace(/\.(json|ya?ml)$/i, '');
    if (LOCALE_RE.test(stem)) locales.add(stem);
    const parent = parts[parts.length - 2];
    if (parent && LOCALE_RE.test(parent) && !I18N_DIR_NAMES.includes(parent)) locales.add(parent);
  }
  let defaultLocale = null;
  const configFiles = files.filter(
    (f) => /(i18n|routing|locale|intl|next\.config|nuxt\.config|astro\.config|site\.config)/i.test(basename(f)) && /\.(ts|js|mjs|cjs|json|tsx)$/i.test(f),
  );
  for (const f of configFiles.slice(0, 30)) {
    const text = await readText(root, f);
    const m =
      text.match(/defaultLocale\s*[:=]\s*['"]([a-z]{2}(?:-[A-Za-z]{2})?)['"]/) ||
      text.match(/fallbackLng\s*[:=]\s*['"]([a-z]{2}(?:-[A-Za-z]{2})?)['"]/) ||
      text.match(/\blng\s*[:=]\s*['"]([a-z]{2}(?:-[A-Za-z]{2})?)['"]/);
    if (m) {
      defaultLocale = m[1];
      break;
    }
  }
  return { dirs: [...dirs].sort(), locales: [...locales].sort(), defaultLocale, messages: messages.slice(0, 40) };
}

function guessLanguageFromText(text) {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 10) return null;
  let best = null;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const hits = words.filter((w) => set.has(w)).length;
    if (hits >= 3 && (!best || hits > best.hits)) best = { lang, hits };
  }
  return best?.lang || null;
}

async function detectLanguage(root, files, i18n, readme, landing) {
  if (i18n.defaultLocale) return { language: i18n.defaultLocale.slice(0, 2).toLowerCase(), source: 'i18n.defaultLocale' };
  const htmlFiles = [
    ...files.filter((f) => /(^|\/)index\.html$/.test(f)),
    ...files.filter((f) => /(^|\/)layout\.(tsx|jsx)$/.test(f)),
    ...files.filter((f) => /(^|\/)app\.html$/.test(f)),
  ].slice(0, 10);
  for (const f of htmlFiles) {
    const text = await readText(root, f);
    const m = text.match(/<html[^>]*\slang=["']([a-z]{2})(?:-[A-Za-z]{2})?["']/i);
    if (m) return { language: m[1].toLowerCase(), source: f };
  }
  if (readme) {
    const guess = guessLanguageFromText(await readText(root, readme));
    if (guess) return { language: guess, source: readme };
  }
  for (const f of landing.slice(0, 3)) {
    const guess = guessLanguageFromText(await readText(root, f));
    if (guess) return { language: guess, source: f };
  }
  return { language: 'en', source: 'default' };
}

/* ---------- design tokens ---------- */

function extractBlock(text, startIndex) {
  const open = text.indexOf('{', startIndex);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

function firstFamily(value) {
  const m = value.match(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z][\w -]*?))\s*(?:,|$)/);
  const fam = (m && (m[1] || m[2] || m[3]))?.trim();
  if (!fam || /^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|inherit|var\(.*)$/i.test(fam)) return null;
  return fam;
}

function parseCssVars(text, file, out) {
  const varRe = /--([\w-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = varRe.exec(text))) {
    const name = m[1];
    const value = m[2].trim();
    if (COLOR_VALUE.test(value)) {
      out.colors.push({ name: name.replace(/^color-/, ''), value, file });
    } else if (/font/i.test(name)) {
      const fam = firstFamily(value);
      if (fam) out.fonts.push({ family: fam, source: 'css', file });
    }
  }
}

function parseTailwindTheme(text, file, out) {
  let idx = 0;
  let found = false;
  while ((idx = text.indexOf('@theme', idx)) !== -1) {
    found = true;
    parseCssVars(extractBlock(text, idx), file, out);
    idx += 6;
  }
  return found;
}

function parseTailwindConfig(text, file, out) {
  let m;
  const nested = /([A-Za-z][\w-]*)\s*:\s*\{\s*DEFAULT\s*:\s*['"]([^'"]+)['"]/g;
  while ((m = nested.exec(text))) {
    if (COLOR_VALUE.test(m[2])) out.colors.push({ name: m[1], value: m[2], file });
  }
  const flat = /(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:\s*['"](#[0-9a-fA-F]{3,8}|(?:rgb|hsl|oklch)a?\([^)]*\))['"]/g;
  while ((m = flat.exec(text))) {
    const name = m[1] || m[2] || m[3];
    if (name === 'DEFAULT') continue;
    out.colors.push({ name, value: m[4], file });
  }
  const fontBlock = text.match(/fontFamily\s*:\s*\{([\s\S]*?)\}/);
  if (fontBlock) {
    const entry = /([A-Za-z][\w-]*)\s*:\s*\[\s*['"]([^'"]+)['"]/g;
    while ((m = entry.exec(fontBlock[1]))) {
      out.fonts.push({ family: m[2], source: 'tailwind', role: m[1], file });
    }
  }
}

function parseGoogleFonts(text, file, out) {
  const nextFont = text.match(/import\s*\{([^}]+)\}\s*from\s*['"]next\/font\/google['"]/);
  if (nextFont) {
    for (const name of nextFont[1].split(',')) {
      const fam = name.trim().split(/\s+as\s+/)[0].replace(/_/g, ' ').trim();
      if (fam) out.fonts.push({ family: fam, source: 'google', file });
    }
  }
  const linkRe = /fonts\.googleapis\.com\/css2?\?([^"'\s)]+)/g;
  let m;
  while ((m = linkRe.exec(text))) {
    for (const part of m[1].split('&')) {
      const fm = part.match(/^family=([^:&]+)/);
      if (fm) out.fonts.push({ family: decodeURIComponent(fm[1]).replace(/\+/g, ' '), source: 'google', file });
    }
  }
  const meta = text.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
  if (meta && COLOR_VALUE.test(meta[1])) out.colors.push({ name: 'theme-color', value: meta[1], file });
}

function suggestPalette(colors) {
  const byName = (patterns) => {
    for (const re of patterns) {
      const hit = colors.find((c) => re.test(c.name) && !/var\(/.test(c.value));
      if (hit) return hit.value;
    }
    return null;
  };
  const accent = byName([/^accent$/i, /accent/i, /highlight/i]);
  return {
    primary: byName([/^primary$/i, /^brand$/i, /primary/i, /brand/i, /^main$/i, /theme-color/i]) || accent,
    secondary: byName([/^secondary$/i, /secondary/i]),
    accent,
    background: byName([/^(background|bg|paper|canvas|base)$/i, /^background/i, /^bg/i, /^paper/i]),
    surface: byName([/^surface$/i, /^card$/i, /surface/i, /card/i, /^(paper|bg|background)-?2$/i]),
    text: byName([/^(text|foreground|fg|ink)$/i, /^foreground/i, /^text/i, /^ink/i]),
    muted: byName([/^muted$/i, /muted/i, /subtle/i]),
  };
}

function titleCase(slug) {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

async function analyzeDesign(root, files, appDir) {
  const out = { colors: [], fonts: [], files: [] };
  const scoped = appDir ? files.filter((f) => inDir(f, appDir)) : files;
  const score = (f) => (/(global|index|app|main|style|theme|token|variable|tailwind|base|root)/i.test(basename(f)) ? 0 : 1) + depthOf(f) * 0.01;
  const cssFiles = scoped
    .filter((f) => /\.(css|scss|pcss)$/i.test(f) && !/\.min\./.test(f))
    .sort((a, b) => score(a) - score(b))
    .slice(0, 40);
  let sawTheme = false;
  for (const f of cssFiles) {
    const text = await readText(root, f);
    if (!text) continue;
    const before = out.colors.length + out.fonts.length;
    if (parseTailwindTheme(text, f, out)) sawTheme = true;
    parseCssVars(text, f, out);
    parseGoogleFonts(text, f, out);
    if (out.colors.length + out.fonts.length > before) out.files.push(f);
  }
  const twConfigs = scoped.filter((f) => /(^|\/)tailwind\.config\.(js|ts|cjs|mjs)$/.test(f));
  for (const f of twConfigs) {
    const text = await readText(root, f);
    const before = out.colors.length + out.fonts.length;
    parseTailwindConfig(text, f, out);
    if (out.colors.length + out.fonts.length > before) out.files.push(f);
  }
  const codeFiles = scoped
    .filter((f) => /(^|\/)(layout|_app|_document|index|app|main)\.(tsx|jsx|ts|js|html|astro|vue)$/i.test(f))
    .slice(0, 20);
  for (const f of codeFiles) {
    const text = await readText(root, f);
    const before = out.colors.length + out.fonts.length;
    parseGoogleFonts(text, f, out);
    if (out.colors.length + out.fonts.length > before) out.files.push(f);
  }
  for (const rel of files.filter((f) => basename(f) === 'package.json' && depthOf(f) <= 3)) {
    const pkg = await readJson(root, rel);
    const deps = Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) });
    for (const d of deps) {
      const m = d.match(/^@fontsource(?:-variable)?\/(.+)$/);
      if (m) out.fonts.push({ family: titleCase(m[1]), source: 'fontsource', file: rel });
    }
  }
  let source = 'none';
  if (sawTheme) source = 'tailwind-v4';
  else if (twConfigs.length) source = 'tailwind-v3';
  else if (out.colors.length) source = 'css-vars';

  const seenColors = new Set();
  const colors = out.colors.filter((c) => (seenColors.has(c.name) ? false : seenColors.add(c.name)));
  const seenFonts = new Set();
  const fonts = out.fonts.filter((f) => {
    const key = f.family.toLowerCase();
    return seenFonts.has(key) ? false : seenFonts.add(key);
  });
  return { source, colors: colors.slice(0, 80), fonts: fonts.slice(0, 10), suggested: suggestPalette(colors), files: [...new Set(out.files)] };
}

/* ---------- logos, urls, names ---------- */

function findLogos(files) {
  const re = /(logo|wordmark|brandmark|(^|[-_])mark([-_.]|$)|icon-?\d*\.|favicon|apple-touch|og-?(image|cover)|opengraph|twitter-image)/i;
  const hits = files.filter(
    (f) =>
      /\.(svg|png|webp|jpg|jpeg|ico)$/i.test(f) &&
      re.test(basename(f)) &&
      (/(^|\/)(public|brand|branding|assets|static|images|img|media)(\/|$)/i.test(f) || depthOf(f) === 0),
  );
  const rank = (f) => {
    const n = basename(f).toLowerCase();
    let s = 0;
    if (n.includes('wordmark')) s -= 4;
    if (n.includes('logo')) s -= 3;
    if (/(^|[-_])mark/.test(n)) s -= 2;
    if (n.endsWith('.svg')) s -= 1;
    if (n.includes('favicon') || n.includes('apple-touch')) s += 2;
    return s;
  };
  return hits.sort((a, b) => rank(a) - rank(b) || a.length - b.length).slice(0, 25);
}

async function findUrls(root, files, readme, packages) {
  const texts = [];
  if (readme) texts.push(await readText(root, readme));
  for (const p of packages) {
    const pkg = await readJson(root, p.dir === '.' ? 'package.json' : `${p.dir}/package.json`);
    if (pkg?.homepage) texts.push(String(pkg.homepage));
  }
  const configs = files
    .filter((f) => /(next\.config|astro\.config|nuxt\.config|vercel\.json|site\.config|\.env\.example|robots\.txt|sitemap|layout\.(tsx|jsx)|metadata)/i.test(basename(f)))
    .slice(0, 15);
  for (const f of configs) texts.push(await readText(root, f));
  const seen = new Set();
  for (const text of texts) {
    for (const url of text.match(URL_RE) || []) {
      let parsed;
      try {
        parsed = new URL(url.replace(/[.,;:!?]+$/, ''));
      } catch {
        continue;
      }
      if (IGNORED_URL_HOSTS.test(parsed.hostname)) continue;
      seen.add(parsed.origin);
    }
  }
  return [...seen].slice(0, 8);
}

async function findProductNames(root, files, readme, packages, app) {
  const names = [];
  const htmlLike = files.filter((f) => /(^|\/)(index\.html|layout\.(tsx|jsx)|app\.html|_document\.(tsx|jsx))$/.test(f)).slice(0, 6);
  for (const f of htmlLike) {
    const text = await readText(root, f);
    const m =
      text.match(/<title>([^<]{1,80})<\/title>/i) ||
      text.match(/\btitle\s*:\s*['"]([^'"]{1,80})['"]/) ||
      text.match(/\bdefault\s*:\s*['"]([^'"]{1,80})['"]/);
    if (m) names.push(m[1].trim());
  }
  if (readme) {
    const text = await readText(root, readme);
    const h1 = text.match(/^#\s+(.+)$/m);
    if (h1) {
      const title = h1[1].replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[*_`]/g, '').trim();
      if (!BOILERPLATE_TITLE.test(title)) names.push(title);
    }
  }
  if (app?.name) names.push(app.name);
  for (const p of packages) if (p.dir === '.' && p.name) names.push(p.name);
  return [...new Set(names.filter(Boolean))].slice(0, 6);
}

// README headings left behind by scaffolding tools and templates.
const BOILERPLATE_TITLE = /(instructions|getting started|readme|template|boilerplate|starter|welcome to|create[- ]next[- ]app|create[- ]react[- ]app|vite \+|project title|your project)/i;

/* ---------- main ---------- */

/**
 * Scans a project directory.
 * @param {string} rootDir
 */
export async function scanProject(rootDir) {
  const root = resolve(rootDir);
  const { files, truncated } = await listFiles(root);
  const packages = await analyzePackages(root, files);
  const app = pickApp(packages);
  const appDir = app && app.dir !== '.' ? app.dir : null;
  const readme = findReadme(files);
  const docs = findDocs(files);
  const landing = findLanding(files, appDir);
  const pricing = findPricing(files, appDir);
  const i18n = await analyzeI18n(root, files);
  const lang = await detectLanguage(root, files, i18n, readme, landing);
  const design = await analyzeDesign(root, files, appDir);
  const logos = findLogos(files);
  const urls = await findUrls(root, files, readme, packages);
  const productNames = await findProductNames(root, files, readme, packages, app);
  return {
    root,
    scannedAt: new Date().toISOString(),
    fileCount: files.length,
    truncated,
    packages,
    app,
    readme,
    docs,
    landing,
    pricing,
    i18n,
    language: lang.language,
    languageSource: lang.source,
    design,
    logos,
    urls,
    productNames,
  };
}

function parseArgs(argv) {
  const args = { root: process.cwd(), help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scan-project.mjs [--root DIR]\nPrints a JSON summary of the product repository.');
    process.exit(0);
  }
  scanProject(args.root)
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    })
    .catch((err) => {
      console.error(`scan-project failed: ${err.message}`);
      process.exit(1);
    });
}

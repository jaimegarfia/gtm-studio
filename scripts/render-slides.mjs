#!/usr/bin/env node
// Renders a post's slides.json into PNG images (one per slide), small
// thumbnails and, for carousels, a multi-page PDF, using the network's HTML
// templates and the brand tokens from marketing/brand.md.
//
// Usage:
//   node render-slides.mjs --post DIR [--brand FILE] [--network FILE] [--templates DIR]
//                          [--project-root DIR] [--marketing DIR] [--offline]
//
// DIR is the post folder (marketing/posts/YYYY-MM-DD-slug). Defaults: brand.md
// and the marketing folder are found two levels up from the post folder; the
// network spec and templates come from this plugin's networks/<id>/ folder.

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contrastColor, readBrand, tokensToCssVars } from './lib/brand.mjs';
import { PLUGIN_ROOT, launchBrowser } from './lib/browser.mjs';
import { renderTemplate } from './lib/template.mjs';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export class RenderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RenderError';
  }
}

export async function fileToDataUri(absPath) {
  const mime = MIME[extname(absPath).toLowerCase()];
  if (!mime) throw new RenderError(`Unsupported image type: ${absPath}`);
  const buf = await readFile(absPath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function resolveAsset(path, roots) {
  if (!path) return null;
  if (isAbsolute(path)) return existsSync(path) ? path : null;
  for (const root of roots) {
    const candidate = resolve(root, path);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function titleSize(title) {
  const len = String(title || '').length;
  if (len <= 40) return '';
  if (len <= 70) return 'small';
  return 'xsmall';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fontLink(tokens) {
  if (tokens.fonts.source !== 'google') return '';
  const families = [...new Set([tokens.fonts.heading, tokens.fonts.body])].filter(Boolean);
  const query = families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;600;700;800`).join('&');
  return `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=swap">`;
}

function wrapDocument({ tokens, size, baseCss, sections, offline }) {
  const vars = [tokensToCssVars(tokens), `--brand-on-primary: ${contrastColor(tokens.colors.primary)};`, `--slide-w: ${size.width}px;`, `--slide-h: ${size.height}px;`].join('\n');
  return `<!doctype html>
<html lang="${tokens.language}">
<head>
<meta charset="utf-8">
${offline ? '' : fontLink(tokens)}
<style>:root{\n${vars}\n}</style>
<style>${baseCss}</style>
</head>
<body>
${sections.join('\n')}
</body>
</html>`;
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    const timeout = new Promise((r) => setTimeout(r, 5000));
    await Promise.race([fonts, timeout]);
    await Promise.all(
      [...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))),
    );
  });
}

async function thumbnailFromPng(page, pngBuffer, width, height) {
  const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  const jpeg = await page.evaluate(
    async ({ src, w, h }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.82);
    },
    { src: dataUri, w: width, h: height },
  );
  return Buffer.from(jpeg.split(',')[1], 'base64');
}

async function removeStale(dir, pattern, keepUpTo) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const m = pattern.exec(name);
    if (m && Number(m[1]) > keepUpTo) await unlink(join(dir, name));
  }
}

/**
 * Renders one post folder.
 * @returns {Promise<{format:string, browser:string, slides:number, files:string[], thumbs:string[], pdf:string|null, warnings:string[]}>}
 */
export async function renderPost(options) {
  const postDir = resolve(options.postDir);
  const marketingDir = resolve(options.marketingDir || join(postDir, '..', '..'));
  const projectRoot = resolve(options.projectRoot || join(marketingDir, '..'));
  const brandPath = resolve(options.brandPath || join(marketingDir, 'brand.md'));
  const slidesPath = join(postDir, 'slides.json');
  if (!existsSync(slidesPath)) throw new RenderError(`Cannot find ${slidesPath}.`);

  let spec;
  try {
    spec = JSON.parse(await readFile(slidesPath, 'utf8'));
  } catch (err) {
    throw new RenderError(`${slidesPath} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) throw new RenderError(`${slidesPath} has no slides.`);

  const { tokens } = await readBrand(brandPath);
  const networkPath = resolve(options.networkPath || join(PLUGIN_ROOT, 'networks', spec.network || 'linkedin', 'network.json'));
  const network = JSON.parse(await readFile(networkPath, 'utf8'));
  const format = spec.format || 'carousel';
  const formatSpec = network.formats[format];
  if (!formatSpec) throw new RenderError(`Unknown format "${format}" for network ${network.id}.`);
  if (!formatSpec.image) throw new RenderError(`Format "${format}" has no images to render.`);
  const size = formatSpec.image;
  const templatesDir = resolve(options.templatesDir || join(networkPath, '..', 'templates'));
  const baseCss = await readFile(join(templatesDir, 'base.css'), 'utf8');

  const warnings = [];
  if (formatSpec.slides) {
    const n = spec.slides.length;
    if (n < formatSpec.slides.min || n > formatSpec.slides.max) {
      warnings.push(`Carousel has ${n} slides; ${network.name} works best with ${formatSpec.slides.min}-${formatSpec.slides.max}.`);
    }
  }

  const assetRoots = [postDir, marketingDir, projectRoot];
  const logoPath = resolveAsset(tokens.logo.path, [projectRoot, marketingDir]);
  const logoInversePath = resolveAsset(tokens.logo.inversePath, [projectRoot, marketingDir]);
  if (tokens.logo.path && !logoPath) warnings.push(`Logo not found: ${tokens.logo.path} (slides show the product name instead).`);
  const logo = logoPath ? await fileToDataUri(logoPath) : '';
  const logoInverse = logoInversePath ? await fileToDataUri(logoInversePath) : logo;
  const website = tokens.website ? tokens.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';

  const total = spec.slides.length;
  const templateCache = new Map();
  async function template(name) {
    if (!templateCache.has(name)) {
      const file = join(templatesDir, `${name}.html`);
      if (!existsSync(file)) throw new RenderError(`Unknown template "${name}" (no ${file}).`);
      templateCache.set(name, await readFile(file, 'utf8'));
    }
    return templateCache.get(name);
  }

  const sections = [];
  for (let i = 0; i < total; i++) {
    const slide = spec.slides[i];
    const name = slide.template || 'point';
    const inverted = name === 'cover' || name === 'cta';
    const data = {
      ...slide,
      product: tokens.product,
      website,
      logo: inverted ? logoInverse : logo,
      page: i + 1,
      total,
      pageClass: `page${i === total - 1 ? ' last' : ''}`,
      titleSize: titleSize(slide.title),
      showPage: total > 1,
      frame: slide.frame === 'phone' ? 'phone' : 'browser',
      isBrowser: slide.frame !== 'phone',
    };
    if (name === 'screenshot') {
      const imagePath = resolveAsset(slide.image, assetRoots);
      if (imagePath) {
        const buf = await readFile(imagePath);
        if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
          const w = buf.readUInt32BE(16);
          const h = buf.readUInt32BE(20);
          if (w > 2200 || (slide.frame !== 'phone' && w / h < 0.9 && h > 1600)) {
            warnings.push(`Slide ${i + 1}: ${slide.image} is a full-page screenshot (${w}x${h}); its text will be tiny on a phone. Capture one section with a CSS selector (route@selector) instead.`);
          }
        }
        data.image = await fileToDataUri(imagePath);
      } else {
        warnings.push(`Slide ${i + 1}: image not found (${slide.image || 'none given'}); rendered the text-only fallback.`);
        data.image = '';
        data.fallbackBody = slide.fallbackBody || slide.caption || '';
      }
    }
    sections.push(renderTemplate(await template(name), data));
  }

  await mkdir(join(postDir, 'thumbs'), { recursive: true });
  const { browser, kind } = await launchBrowser();
  const files = [];
  const thumbs = [];
  let pdf = null;
  try {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.emulateMedia({ media: 'screen' });
    const thumbW = Math.round(size.width / 4);
    const thumbH = Math.round(size.height / 4);
    for (let i = 0; i < total; i++) {
      const html = wrapDocument({ tokens, size, baseCss, sections: [sections[i]], offline: options.offline });
      await page.setContent(html, { waitUntil: 'load' });
      await waitForAssets(page);
      const png = await page.screenshot({ type: 'png', fullPage: false });
      const file = join(postDir, `slide-${pad(i + 1)}.png`);
      await writeFile(file, png);
      files.push(file);
      const thumb = join(postDir, 'thumbs', `slide-${pad(i + 1)}.jpg`);
      await writeFile(thumb, await thumbnailFromPng(page, png, thumbW, thumbH));
      thumbs.push(thumb);
    }
    if (formatSpec.pdf) {
      const html = wrapDocument({ tokens, size, baseCss, sections, offline: options.offline });
      await page.setContent(html, { waitUntil: 'load' });
      await waitForAssets(page);
      pdf = join(postDir, 'carousel.pdf');
      await page.pdf({
        path: pdf,
        width: `${size.width}px`,
        height: `${size.height}px`,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: false,
      });
    } else if (existsSync(join(postDir, 'carousel.pdf'))) {
      await unlink(join(postDir, 'carousel.pdf'));
    }
    await context.close();
  } finally {
    await browser.close();
  }
  await removeStale(postDir, /^slide-(\d+)\.png$/, total);
  await removeStale(join(postDir, 'thumbs'), /^slide-(\d+)\.jpg$/, total);

  return { format, browser: kind, slides: total, files, thumbs, pdf, warnings };
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
  if (args.help || !args.post) {
    console.log('Usage: node render-slides.mjs --post DIR [--brand FILE] [--network FILE] [--templates DIR] [--project-root DIR] [--marketing DIR] [--offline]');
    process.exit(args.help ? 0 : 1);
  }
  renderPost({
    postDir: args.post,
    brandPath: args.brand,
    networkPath: args.network,
    templatesDir: args.templates,
    projectRoot: args['project-root'],
    marketingDir: args.marketing,
    offline: Boolean(args.offline),
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(err.name === 'RenderError' || err.name === 'BrandTokensError' || err.name === 'BrowserUnavailableError' ? err.message : err.stack);
      process.exit(1);
    });
}

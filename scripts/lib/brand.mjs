// Reads the machine-readable tokens block out of marketing/brand.md.
//
// brand.md is written for humans (and for Claude) in the product's language,
// but the visual templates need a few exact values. Those live in one JSON
// block preceded by an HTML comment marker so the rest of the file can be
// edited freely:
//
//   <!-- gtm-studio:tokens -->
//   ```json
//   { "product": "...", "language": "es", "colors": {...}, "fonts": {...}, "logo": {...} }
//   ```

import { readFile } from 'node:fs/promises';

export const TOKENS_MARKER = '<!-- gtm-studio:tokens -->';

export class BrandTokensError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrandTokensError';
  }
}

const DEFAULT_COLORS = {
  primary: '#1f2937',
  background: '#ffffff',
  text: '#111827',
};

/**
 * Extracts and normalizes the tokens block from brand.md markdown.
 * @param {string} markdown
 * @returns {BrandTokens}
 */
export function parseBrandTokens(markdown) {
  const markerIndex = markdown.indexOf(TOKENS_MARKER);
  if (markerIndex === -1) {
    throw new BrandTokensError(
      `brand.md has no tokens block. Add a "${TOKENS_MARKER}" comment followed by a \`\`\`json fenced block, or re-run /gtm-studio:brand.`,
    );
  }
  const after = markdown.slice(markerIndex + TOKENS_MARKER.length);
  const fence = after.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (!fence) {
    throw new BrandTokensError(
      `Found "${TOKENS_MARKER}" but no \`\`\`json fenced block right after it.`,
    );
  }
  let raw;
  try {
    raw = JSON.parse(fence[1]);
  } catch (err) {
    throw new BrandTokensError(`The tokens block in brand.md is not valid JSON: ${err.message}`);
  }
  return normalizeTokens(raw);
}

/**
 * Validates required fields and fills derived defaults.
 * @param {object} raw
 * @returns {BrandTokens}
 */
export function normalizeTokens(raw) {
  if (!raw || typeof raw !== 'object') throw new BrandTokensError('Tokens must be a JSON object.');
  if (!raw.product || typeof raw.product !== 'string') {
    throw new BrandTokensError('Tokens are missing "product" (the product name).');
  }
  if (!raw.language || typeof raw.language !== 'string') {
    throw new BrandTokensError('Tokens are missing "language" (e.g. "en", "es").');
  }
  const c = { ...DEFAULT_COLORS, ...(raw.colors || {}) };
  const colors = {
    primary: c.primary,
    secondary: c.secondary || c.primary,
    accent: c.accent || c.primary,
    background: c.background,
    surface: c.surface || c.background,
    text: c.text,
    muted: c.muted || c.text,
  };
  const f = raw.fonts || {};
  const fonts = {
    heading: f.heading || f.body || 'Inter',
    body: f.body || f.heading || 'Inter',
    source: f.source || 'system',
  };
  const l = raw.logo || {};
  const logo = {
    path: l.path || null,
    inversePath: l.inversePath || null,
    markPath: l.markPath || null,
  };
  return {
    product: raw.product,
    language: raw.language.toLowerCase(),
    website: raw.website || null,
    colors,
    fonts,
    logo,
  };
}

/**
 * Renders the tokens as CSS custom properties for the slide templates.
 * @param {BrandTokens} tokens
 * @returns {string}
 */
export function tokensToCssVars(tokens) {
  const lines = [];
  for (const [name, value] of Object.entries(tokens.colors)) {
    lines.push(`--brand-${name}: ${value};`);
  }
  lines.push(`--font-heading: "${tokens.fonts.heading}";`);
  lines.push(`--font-body: "${tokens.fonts.body}";`);
  return lines.join('\n');
}

/**
 * Reads brand.md from disk.
 * @param {string} brandPath
 * @returns {Promise<{ tokens: BrandTokens, markdown: string }>}
 */
export async function readBrand(brandPath) {
  let markdown;
  try {
    markdown = await readFile(brandPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new BrandTokensError(`Cannot find ${brandPath}. Run /gtm-studio:brand first.`);
    }
    throw err;
  }
  return { tokens: parseBrandTokens(markdown), markdown };
}

/**
 * @typedef {object} BrandTokens
 * @property {string} product
 * @property {string} language
 * @property {string|null} website
 * @property {{primary:string,secondary:string,accent:string,background:string,surface:string,text:string,muted:string}} colors
 * @property {{heading:string,body:string,source:string}} fonts
 * @property {{path:string|null,inversePath:string|null,markPath:string|null}} logo
 */

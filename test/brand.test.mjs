import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseBrandTokens,
  normalizeTokens,
  tokensToCssVars,
  readBrand,
  BrandTokensError,
} from '../scripts/lib/brand.mjs';

const sample = `# CVora brand

Some prose that a human edited.

## Visual identity

<!-- gtm-studio:tokens -->
\`\`\`json
{
  "product": "CVora",
  "language": "es",
  "website": "https://cvora.net",
  "colors": { "primary": "#112233", "background": "#ffffff", "text": "#111111" },
  "fonts": { "heading": "Space Grotesk", "body": "Inter", "source": "google" },
  "logo": { "path": "brand/wordmark.svg" }
}
\`\`\`

More prose after the block.
`;

test('parseBrandTokens reads the JSON block after the marker', () => {
  const tokens = parseBrandTokens(sample);
  assert.equal(tokens.product, 'CVora');
  assert.equal(tokens.language, 'es');
  assert.equal(tokens.colors.primary, '#112233');
  assert.equal(tokens.fonts.heading, 'Space Grotesk');
  assert.equal(tokens.logo.path, 'brand/wordmark.svg');
});

test('parseBrandTokens fills defaults for missing colors and logo fields', () => {
  const tokens = parseBrandTokens(sample);
  assert.equal(tokens.colors.secondary, '#112233');
  assert.equal(tokens.colors.accent, '#112233');
  assert.equal(tokens.colors.surface, '#ffffff');
  assert.equal(tokens.colors.muted, '#111111');
  assert.equal(tokens.logo.inversePath, null);
  assert.equal(tokens.logo.markPath, null);
});

test('linkPlacement defaults to first-comment and timezone to null', () => {
  const tokens = parseBrandTokens(sample);
  assert.equal(tokens.linkPlacement, 'first-comment');
  assert.equal(tokens.timezone, null);
  const body = normalizeTokens({ product: 'X', language: 'es', linkPlacement: 'body', timezone: 'America/Bogota' });
  assert.equal(body.linkPlacement, 'body');
  assert.equal(body.timezone, 'America/Bogota');
  assert.equal(normalizeTokens({ product: 'X', language: 'es', linkPlacement: 'anywhere' }).linkPlacement, 'first-comment');
});

test('parseBrandTokens throws a clear error when the marker is missing', () => {
  assert.throws(() => parseBrandTokens('# Brand\n\nNo tokens here.'), (err) => {
    assert.ok(err instanceof BrandTokensError);
    assert.match(err.message, /gtm-studio:tokens/);
    return true;
  });
});

test('parseBrandTokens throws a clear error on invalid JSON', () => {
  const broken = '<!-- gtm-studio:tokens -->\n```json\n{ "product": "X", }\n```\n';
  assert.throws(() => parseBrandTokens(broken), (err) => {
    assert.ok(err instanceof BrandTokensError);
    assert.match(err.message, /JSON/);
    return true;
  });
});

test('normalizeTokens requires product and language', () => {
  assert.throws(() => normalizeTokens({ language: 'en' }), /product/);
  assert.throws(() => normalizeTokens({ product: 'X' }), /language/);
});

test('tokensToCssVars emits brand and font variables', () => {
  const css = tokensToCssVars(parseBrandTokens(sample));
  assert.match(css, /--brand-primary:\s*#112233;/);
  assert.match(css, /--brand-background:\s*#ffffff;/);
  assert.match(css, /--font-heading:\s*"Space Grotesk";/);
  assert.match(css, /--font-body:\s*"Inter";/);
});

test('readBrand reads a file and returns tokens plus markdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gtm-brand-'));
  const file = join(dir, 'brand.md');
  await writeFile(file, sample, 'utf8');
  const { tokens, markdown } = await readBrand(file);
  assert.equal(tokens.product, 'CVora');
  assert.match(markdown, /CVora brand/);
});

test('readBrand names the file when it does not exist', async () => {
  await assert.rejects(readBrand(join(tmpdir(), 'nope', 'brand.md')), /brand\.md/);
});

// A tiny Mustache-style template engine for the slide templates.
//
// Supported:
//   {{name}}            HTML-escaped value (dot paths allowed: {{logo.src}})
//   {{{name}}}          raw value, not escaped
//   {{#if name}}…{{/if}}         rendered when the value is truthy (non-empty arrays count)
//   {{#unless name}}…{{/unless}} rendered when the value is falsy
//   {{#each list}}…{{/each}}     repeats for each item; inside, {{.}} is the item,
//                                {{@index}} the 0-based index, {{@number}} the 1-based one,
//                                and item properties resolve directly ({{title}})
//
// Blocks nest, including blocks of the same kind. No logic beyond that.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lookup(path, scopes) {
  if (path === '.' || path === 'this') return scopes[scopes.length - 1];
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope === null || typeof scope !== 'object') continue;
    let value = scope;
    let found = true;
    for (const part of path.split('.')) {
      if (value !== null && typeof value === 'object' && part in value) value = value[part];
      else {
        found = false;
        break;
      }
    }
    if (found) return value;
  }
  return undefined;
}

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

const OPEN_RE = /\{\{#(if|unless|each)\s+([\w.@]+)\s*\}\}/g;

/** Finds the first block and its matching close tag, honouring nesting of the same kind. */
function findBlock(source) {
  OPEN_RE.lastIndex = 0;
  const open = OPEN_RE.exec(source);
  if (!open) return null;
  const kind = open[1];
  const tagRe = new RegExp(`\\{\\{(#${kind}\\s+[\\w.@]+\\s*|\\/${kind})\\}\\}`, 'g');
  tagRe.lastIndex = open.index + open[0].length;
  let depth = 1;
  let m;
  while ((m = tagRe.exec(source))) {
    if (m[1].startsWith('#')) depth++;
    else depth--;
    if (depth === 0) {
      return {
        kind,
        path: open[2],
        start: open.index,
        bodyStart: open.index + open[0].length,
        bodyEnd: m.index,
        end: m.index + m[0].length,
      };
    }
  }
  throw new Error(`Template error: unclosed {{#${kind} ${open[2]}}}`);
}

function renderScoped(source, scopes) {
  let out = '';
  let rest = source;
  let block;
  while ((block = findBlock(rest))) {
    out += renderInline(rest.slice(0, block.start), scopes);
    const body = rest.slice(block.bodyStart, block.bodyEnd);
    const value = lookup(block.path, scopes);
    if (block.kind === 'if') {
      if (truthy(value)) out += renderScoped(body, scopes);
    } else if (block.kind === 'unless') {
      if (!truthy(value)) out += renderScoped(body, scopes);
    } else {
      const list = Array.isArray(value) ? value : [];
      list.forEach((item, index) => {
        const meta = { '@index': index, '@number': index + 1, '@first': index === 0, '@last': index === list.length - 1 };
        out += renderScoped(body, [...scopes, meta, item]);
      });
    }
    rest = rest.slice(block.end);
  }
  return out + renderInline(rest, scopes);
}

function renderInline(source, scopes) {
  return source
    .replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/g, (_, path) => String(lookup(path, scopes) ?? ''))
    .replace(/\{\{\s*([\w.@]+)\s*\}\}/g, (_, path) => escapeHtml(lookup(path, scopes) ?? ''));
}

/**
 * Renders a template with the given data.
 * @param {string} source
 * @param {object} data
 * @returns {string}
 */
export function renderTemplate(source, data) {
  return renderScoped(source, [data || {}]);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, escapeHtml } from '../scripts/lib/template.mjs';

test('escapes values by default and allows raw with triple braces', () => {
  const html = renderTemplate('<h1>{{title}}</h1>{{{raw}}}', { title: 'A <b>&</b>', raw: '<i>x</i>' });
  assert.equal(html, '<h1>A &lt;b&gt;&amp;&lt;/b&gt;</h1><i>x</i>');
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('dot paths and missing values', () => {
  assert.equal(renderTemplate('{{logo.src}}|{{missing}}|{{a.b.c}}', { logo: { src: 'x.png' }, a: { b: {} } }), 'x.png||');
});

test('if and unless blocks, arrays count as truthy when non-empty', () => {
  const tpl = '{{#if image}}IMG{{/if}}{{#unless image}}TEXT{{/unless}}{{#if bullets}}B{{/if}}';
  assert.equal(renderTemplate(tpl, { image: '', bullets: [] }), 'TEXT');
  assert.equal(renderTemplate(tpl, { image: 'a.png', bullets: ['x'] }), 'IMGB');
});

test('each with item scope, index and nested blocks', () => {
  const tpl = '{{#each items}}<li class="{{#if @first}}first{{/if}}">{{@number}}. {{title}} ({{.}}){{/each}}';
  const html = renderTemplate(tpl, { items: [{ title: 'One' }, { title: 'Two' }] });
  assert.equal(html, '<li class="first">1. One ([object Object])<li class="">2. Two ([object Object])');
  assert.equal(renderTemplate('{{#each list}}{{.}},{{/each}}', { list: ['a', 'b'] }), 'a,b,');
});

test('same-kind blocks nest correctly', () => {
  const tpl = '{{#if image}}<div>{{#if isBrowser}}BAR{{/if}}<img>{{/if}}{{#unless image}}FALLBACK{{/unless}}';
  assert.equal(renderTemplate(tpl, { image: 'x', isBrowser: true }), '<div>BAR<img>');
  assert.equal(renderTemplate(tpl, { image: 'x', isBrowser: false }), '<div><img>');
  assert.equal(renderTemplate(tpl, { image: '' }), 'FALLBACK');
  const deep = '{{#each rows}}{{#each cols}}{{.}}{{#if @last}};{{/if}}{{/each}}{{/each}}';
  assert.equal(renderTemplate(deep, { rows: [{ cols: ['a', 'b'] }, { cols: ['c'] }] }), 'ab;c;');
  assert.throws(() => renderTemplate('{{#if a}}open', {}), /unclosed/);
});

test('outer scope stays visible inside each', () => {
  assert.equal(renderTemplate('{{#each list}}{{product}}:{{.}} {{/each}}', { product: 'P', list: [1, 2] }), 'P:1 P:2 ');
});

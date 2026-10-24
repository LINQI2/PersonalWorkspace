import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'app/client/tasks/styles.css');
const output = path.join(root, 'app/client/tasks/tasks-scoped.css');

function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function scopeOne(selector) {
  const sel = selector.trim();
  if (!sel) return null;
  if (sel === 'html' || sel === '#root') return null;
  if (sel === 'body') return '.tw-app';
  if (sel === 'body.is-dragging') return 'body.tw-dragging .tw-app';
  if (/^\.tw-app(?![\w-])/.test(sel)) return sel;
  if (sel === '*') return '.tw-app *';
  if (sel === '*::before' || sel === '*::after') return `.tw-app ${sel}`;
  if (sel.startsWith(':root')) return sel.replace(':root', '.tw-app');
  // 任务台类名统一加前缀，避免与知识库同名类冲突
  return `.tw-app ${sel}`;
}

function scopeSelectorList(list) {
  const scoped = [];
  for (const sel of splitSelectors(list)) {
    const value = scopeOne(sel);
    if (value) scoped.push(value);
  }
  return scoped.join(',\n');
}

function transform(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) {
      out += css.slice(i);
      break;
    }
    const prelude = css.slice(i, brace);
    if (prelude.includes('@media') || prelude.includes('@supports')) {
      let depth = 1;
      let j = brace + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        if (css[j] === '}') depth--;
        j++;
      }
      const inner = css.slice(brace + 1, j - 1);
      out += prelude + '{\n' + transform(inner) + '}\n';
      i = j;
      continue;
    }
    if (prelude.includes('@keyframes') || prelude.includes('@-webkit-keyframes')) {
      let depth = 1;
      let j = brace + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        if (css[j] === '}') depth--;
        j++;
      }
      out += css.slice(i, j) + '\n';
      i = j;
      continue;
    }
    let depth = 1;
    let j = brace + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(brace + 1, j - 1);
    const selector = scopeSelectorList(prelude);
    if (selector) out += selector + ' {' + body + '}\n';
    i = j;
  }
  return out;
}

const source = readFileSync(input, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const scoped = transform(source)
  .replace(/\.tw-app \.app \{/g, '.tw-app {')
  .replace(/\.tw-app \.app\b/g, '.tw-app');
writeFileSync(
  output,
  '/* 自动生成：源 styles.css，全部选择器限定在 .tw-app 内，避免污染知识库。 */\n' + scoped,
  'utf8',
);
console.log('written', output, scoped.length);

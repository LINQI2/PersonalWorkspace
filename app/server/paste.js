import { randomUUID } from 'node:crypto';
import { escapeText } from './knowledge/exchange.js';
import { prepareImport } from './knowledge/importer.js';
import { commitV2 } from './knowledge/import-v2.js';
import { visibleSql } from './lifecycle.js';
import { readingText } from '../shared/reading-anchor.js';
const norm = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
function inline(s) {
  // Escape HTML first; only an explicit small Markdown subset is interpreted.
  return escapeText(s)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<em>$1</em>');
}
export function markdownHtml(raw, markdown = true) {
  let out = '',
    list = '',
    code = false;
  const end = () => {
    if (list) {
      out += '</' + list + '>';
      list = '';
    }
  };
  for (const line of raw.split(/\r?\n/)) {
    if (markdown && /^\s*```/.test(line)) {
      end();
      code = !code;
      continue;
    }
    if (!markdown || code) {
      end();
      out += '<p>' + escapeText(line) + '</p>';
      continue;
    }
    const h = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/),
      li = line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
    if (li) {
      const type = li[1] ? 'ul' : 'ol';
      if (list !== type) {
        end();
        list = type;
        out += '<' + type + '>';
      }
      out += '<li>' + inline(li[2]) + '</li>';
    } else {
      end();
      out += h
        ? '<h' +
          (h[1].length === 1 ? 2 : 3) +
          '>' +
          inline(h[2]) +
          '</h' +
          (h[1].length === 1 ? 2 : 3) +
          '>'
        : /^>\s?/.test(line)
          ? '<blockquote><p>' + inline(line.replace(/^>\s?/, '')) + '</p></blockquote>'
          : '<p>' + inline(line) + '</p>';
    }
  }
  end();
  return out;
}
export function parsePaste(input) {
  if (
    !input ||
    typeof input.raw !== 'string' ||
    !input.raw.trim() ||
    input.raw.length > 100000 ||
    Buffer.byteLength(input.raw) > 256 * 1024 ||
    !['text', 'markdown'].includes(input.format) ||
    !['note', 'document'].includes(input.type) ||
    !['chatgpt', 'other', 'inspiration', 'report', 'website'].includes(input.sourceKind) ||
    typeof input.sourceName !== 'string' ||
    input.sourceName.length > 200
  )
    throw Error('粘贴资料格式无效或超过100000字/256KiB，请缩小资料。');
  const lines = input.raw.split(/\r?\n/),
    first = lines.find((l) => l.trim()) || '',
    title = input.title?.trim() || first.replace(/^#+\s*/, '');
  if (!title || title.length > 200) throw Error('请设置1～200字标题。');
  const items = [],
    base = {
      body_format: 'html',
      status: 'review',
      epistemic: input.sourceKind === 'chatgpt' ? 'ai_inference' : 'user_judgment',
      original_date: null,
      references: [{ source_id: 'pasted', quote: '' }],
    };
  const root = { ...base, id: 'root', title, content_type: input.type, body: '' };
  items.push(root);
  if (input.type === 'note' || input.format === 'text')
    root.body = markdownHtml(input.raw, input.format === 'markdown');
  else {
    let current = root,
      buf = [],
      stack = [],
      fenced = false,
      firstHeading = true;
    const flush = () => {
      current.body = markdownHtml(buf.join('\n'));
      buf = [];
    };
    for (const l of lines) {
      if (/^\s*```/.test(l)) fenced = !fenced;
      const h = !fenced && l.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!h) {
        buf.push(l);
        continue;
      }
      if (firstHeading && items.length === 1 && !buf.join('').trim() && h[2] === title) {
        firstHeading = false;
        continue;
      }
      firstHeading = false;
      flush();
      while (stack.length && stack.at(-1).level >= h[1].length) stack.pop();
      current = {
        ...base,
        id: 'section' + items.length,
        title: h[2],
        content_type: 'block',
        parent: stack.at(-1)?.id || 'root',
        body: '',
      };
      if (current.title.length > 200 || items.length >= 100)
        throw Error('章节标题超长或超过99章，请调整后重试，不会截断。');
      items.push(current);
      stack.push({ id: current.id, level: h[1].length });
    }
    flush();
  }
  return {
    format: 'personal-knowledge-exchange',
    version: 2,
    sources: [
      {
        id: 'pasted',
        kind: input.sourceKind,
        title: input.sourceName.trim() || '用户粘贴资料（原始日期未知）',
        excerpt: input.raw,
        original_date: null,
        date_note: '仅用户来源说明，未读取原始对话或核验作者/日期',
      },
    ],
    items,
  };
}
export function pasteDuplicates(db, items) {
  const candidates = db
    .prepare(
      `SELECT e.id,e.title,e.plain_text,e.url FROM entries e WHERE ${visibleSql(db)} ORDER BY updated_at DESC`,
    )
    .all();
  return items.map((i) => ({
    id: i.id,
    matches: candidates
      .filter(
        (e) =>
          norm(e.title) === norm(i.title) ||
          (i.url && i.url === e.url) ||
          (norm(readingText(i.content || '')).length > 60 &&
            norm(e.plain_text).includes(norm(readingText(i.content || '')).slice(0, 80))),
      )
      .slice(0, 8)
      .map((e) => ({
        id: e.id,
        title: e.title,
        reason:
          norm(e.title) === norm(i.title)
            ? '标题相同，不能据此视为同一知识'
            : '正文片段相似，请核对',
      })),
  }));
}
export function createPasteSession(getDb, options = {}) {
  const sessions = new Map();
  const get = (token) => {
    const s = sessions.get(token);
    if (!s || Date.now() - s.at > 900000) throw Error('粘贴预览已过期，请重新解析。');
    return s;
  };
  const check = (input) => {
    const s = get(input.token);
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100)
      throw Error('审核条目无效。');
    const rows = input.items.map((i) => {
      const old = s.prepared.value.items.find((o) => o.id === i.id);
      if (!old || typeof i.title !== 'string' || !i.title.trim() || i.title.length > 200)
        throw Error('审核标题无效。');
      return { ...old, title: i.title };
    });
    return { candidates: pasteDuplicates(getDb(), rows) };
  };
  return {
    check,
    preview(input) {
      const p = parsePaste(input),
        r = prepareImport(getDb(), JSON.stringify(p), 'json');
      const token = randomUUID();
      if (sessions.size >= 8) sessions.delete(sessions.keys().next().value);
      sessions.set(token, { ...r, at: Date.now() });
      return {
        ...r.preview,
        token,
        repeated: getDb()
          .prepare('SELECT id FROM knowledge_imports WHERE hash=?')
          .all(r.prepared.hash),
        candidates: pasteDuplicates(getDb(), r.prepared.value.items),
      };
    },
    commit(input) {
      const s = get(input.token),
        db = getDb();
      if (check(input).candidates.some((c) => c.matches.length) && input.confirmDuplicate !== true)
        throw Error('发现疑似重复，请先核对并明确确认另存。');
      const result = commitV2(db, s.prepared, input, options);
      sessions.delete(input.token);
      return result;
    },
    cancel(token) {
      sessions.delete(token);
      return { ok: true };
    },
  };
}

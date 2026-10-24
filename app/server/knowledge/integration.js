import { randomUUID } from 'node:crypto';
import { validateSchema } from '../ai/schema.js';
import { prepareKnowledgeInput, normalizeIntegration, fingerprint } from '../ai/knowledge.js';
import { getRecord, saveRecord, addSource, transaction } from './store.js';
import { attach, owner, chapterRows } from './structure.js';
import { textHtml } from './exchange.js';
import { hash } from '../assistant/catalog.js';
export function createIntegration(getDb, ai, { cacheResults = true } = {}) {
  const pending = new Map(),
    cache = new Map();
  function expire() {
    for (const [id, r] of pending) if (Date.now() - r.at > 900000) pending.delete(id);
    for (const [id, r] of cache) if (Date.now() - r.at > 900000) cache.delete(id);
  }
  return {
    estimate(input) {
      const p = prepareKnowledgeInput(getDb(), input),
        s = ai.status();
      const normalize = (t) =>
        t
          .normalize('NFKC')
          .toLowerCase()
          .replace(/[\s\p{P}]/gu, '');
      const candidates = [];
      for (let i = 0; i < p.payload.sources.length; i++)
        for (let j = i + 1; j < p.payload.sources.length; j++) {
          const a = p.payload.sources[i],
            b = p.payload.sources[j],
            x = normalize(a.text),
            y = normalize(b.text);
          if (x === y || normalize(a.title) === normalize(b.title))
            candidates.push({
              from: a.id,
              to: b.id,
              fromTitle: a.title,
              toTitle: b.title,
              reason: x === y ? '标准化正文相同' : '标题相同，不能据此合并',
            });
        }
      return {
        chars: p.chars,
        estimatedTokens: p.estimatedTokens,
        estimatedUSD: (p.estimatedTokens * (s.prices?.input || 0)) / 1000000,
        maxChars: 12000,
        insufficient: p.insufficient,
        provider: s.provider,
        model: s.model,
        candidates,
      };
    },
    async generate(input, signal) {
      expire();
      if (pending.size >= 8) throw Error('待审核方案过多，请关闭旧方案。');
      const initial = prepareKnowledgeInput(getDb(), input),
        state = ai.status();
      const initialTarget = input.pageId
        ? hash([getRecord(getDb(), input.pageId), chapterRows(getDb(), input.pageId)])
        : null;
      const key = JSON.stringify([
        initial.snapshots,
        state.provider,
        state.model,
        state.settings.revision,
      ]);
      const cached = cacheResults ? cache.get(key) : null;
      const result = cached
        ? { ...structuredClone(cached.result), fromCache: true, usage: null, usageWarning: '' }
        : await ai.suggest({ ...input, mode: 'integration' }, signal);
      if (result.suggestion.status !== 'ready') return result;
      const p = prepareKnowledgeInput(getDb(), input);
      if (JSON.stringify(p.snapshots) !== JSON.stringify(result.snapshots))
        throw Error('生成期间原资料已变化，请重新选择。');
      if (!cached && cacheResults) {
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(key, { result: structuredClone(result), at: Date.now() });
      }
      const token = randomUUID();
      const target = input.pageId
        ? {
            id: input.pageId,
            hash: hash([getRecord(getDb(), input.pageId), chapterRows(getDb(), input.pageId)]),
          }
        : null;
      if (target && target.hash !== initialTarget)
        throw Error('生成期间目标页面或章节归属已变化，请重新审核。');
      pending.set(token, { p, target, at: Date.now() });
      return { ...result, token };
    },
    cancel(input) {
      pending.delete(input.token);
      return { ok: true };
    },
    apply(input) {
      expire();
      const draft = pending.get(input.token);
      if (!draft || input.confirm !== '采用所选整合建议') throw Error('审核已过期或未明确确认。');
      const db = getDb(),
        p = draft.p;
      for (const s of p.snapshots)
        if (fingerprint(getRecord(db, s.id)) !== s.hash)
          throw Error('原知识已变化，未采用方案，请重新分析。');
      if (
        draft.target &&
        (input.pageId !== draft.target.id ||
          hash([getRecord(db, input.pageId), chapterRows(db, input.pageId)]) !== draft.target.hash)
      )
        throw Error('目标页面或实际章节归属已变化，请重新审核。');
      try {
        validateSchema(input.plan, p.schema);
      } catch {
        throw Error('审核格式无效，未采用任何建议。');
      }
      normalizeIntegration(input.plan, p);
      if (
        input.plan.status !== 'ready' ||
        !Array.isArray(input.sections) ||
        !Array.isArray(input.relations) ||
        input.sections.some((n) => !Number.isInteger(n) || !input.plan.sections[n]) ||
        input.relations.some((n) => !Number.isInteger(n) || !input.plan.relations[n]) ||
        new Set(input.sections).size !== input.sections.length ||
        new Set(input.relations).size !== input.relations.length
      )
        throw Error('审核选择无效。');
      let page = input.newPage ? null : getRecord(db, input.pageId);
      if (page && page.kind !== 'page') throw Error('请指定混合页面。');
      if (
        input.newPage &&
        (typeof input.newPage.title !== 'string' ||
          !input.newPage.title.trim() ||
          input.newPage.title.length > 200)
      )
        throw Error('请填写新综合页面标题。');
      const result = transaction(db, () => {
        if (!page)
          page = saveRecord(
            db,
            {
              title: input.newPage.title,
              content: '<p>经人工审核建立的综合页面；原资料与不同阶段观点保留。</p>',
              description: '跨来源综合整理，需人工验证。',
              kind: 'page',
              directory_id: input.newPage.directory_id || null,
              priority: 0,
              status: 'review',
              epistemic: 'ai_inference',
              questions: '',
              references: p.snapshots.map((s) => s.id),
              domains: input.newPage.domain_id ? [input.newPage.domain_id] : [],
              primary_domain_id: input.newPage.domain_id || null,
              tags: [],
              collections: [],
            },
            undefined,
            { outer: true },
          );
        const created = [];
        for (const n of input.sections) {
          const s = input.plan.sections[n];
          const e = saveRecord(
            db,
            {
              title: s.title,
              description: '经人工采用的 AI 整合稿；原知识仍保留。',
              content: textHtml(s.text),
              kind: 'point',
              directory_id: page.directory_id,
              priority: 0,
              status: 'review',
              epistemic: 'ai_inference',
              questions: input.plan.verification.join('\n'),
              references: [],
              domains: page.domains.map((d) => d.id),
              primary_domain_id: page.primary_domain_id || null,
              tags: [],
              collections: page.collections.map((c) => c.id),
            },
            undefined,
            { outer: true },
          );
          attach(db, { items: [{ id: e.id, parent_id: page.id }] });
          created.push(e.id);
          for (const id of s.sourceIds) {
            const r = getRecord(db, id),
              source = addSource(db, {
                kind: 'other',
                title: r.title.slice(0, 158) + ' · ' + r.id,
                excerpt: r.description + '\n' + r.plain_text,
                original_date: r.original_date,
                date_note: r.date_note,
                provided_recorded_at: r.provided_recorded_at,
              });
            db.prepare('INSERT INTO knowledge_entry_sources VALUES(?,?,?)').run(e.id, source, '');
            db.prepare('INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?)').run(
              randomUUID(),
              e.id,
              id,
              'complement',
              'candidate',
              '整合稿来源：原知识保留，可对照阅读。',
              new Date().toISOString(),
            );
          }
        }
        for (const n of input.relations) {
          const r = input.plan.relations[n];
          if (r.kind === 'related') continue;
          db.prepare('INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?)').run(
            randomUUID(),
            r.from,
            r.to,
            r.kind,
            'candidate',
            r.reason + '\n依据：' + r.fromQuote + ' / ' + r.toQuote,
            new Date().toISOString(),
          );
        }
        if (input.adoptOrder === true) {
          const ids = input.plan.order;
          if (
            ids.some(
              (id) =>
                owner(db, id) !== page.id ||
                db.prepare('SELECT parent_id FROM knowledge_structure WHERE entry_id=?').get(id)
                  ?.parent_id !== page.id,
            )
          )
            throw Error('阅读顺序仅能调整当前页面直属章节。');
          const rest = db
            .prepare(
              'SELECT entry_id FROM knowledge_structure WHERE parent_id=? ORDER BY position,entry_id',
            )
            .all(page.id)
            .map((r) => r.entry_id)
            .filter((id) => !ids.includes(id));
          [...ids, ...rest].forEach((id, n) =>
            db.prepare('UPDATE knowledge_structure SET position=? WHERE entry_id=?').run(n, id),
          );
        }
        return { ok: true, created, pageId: page.id };
      });
      pending.delete(input.token);
      return result;
    },
  };
}

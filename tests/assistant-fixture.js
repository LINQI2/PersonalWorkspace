import { saveEntry } from '../app/server/store.js';
import { saveDirectory, saveRecord, addSource } from '../app/server/knowledge/store.js';
import { fixtureForm } from './ai-fixture.js';
import { knowledgeForm, integrationPlan } from './knowledge-reading-fixture.js';
export function assistantFixture(db) {
  for (const [kind, rows] of [
    [
      'tags',
      [
        ['tag-a', 'AI工具'],
        ['tag-b', 'AI 工具'],
      ],
    ],
    [
      'domains',
      [
        ['domain-a', '实验'],
        ['domain-b', '实验方法'],
      ],
    ],
    [
      'collections',
      [
        ['topic-a', '实验专题'],
        ['topic-b', '研究专题'],
      ],
    ],
  ])
    for (const row of rows) db.prepare(`INSERT INTO ${kind} VALUES(?,?)`).run(...row);
  const root = saveDirectory(db, { name: '研究目录', parent_id: null }),
    other = saveDirectory(db, { name: '其他', parent_id: null }),
    child = saveDirectory(db, { name: '观察章节', parent_id: root.id });
  const page = saveRecord(
    db,
    knowledgeForm('实验研究页面', { kind: 'page', directory_id: root.id }),
  );
  const a = saveRecord(
    db,
    knowledgeForm('小样本实验观察', {
      directory_id: root.id,
      original_date: '2026-09-01',
      tags: ['tag-a'],
      domains: ['domain-a'],
      collections: ['topic-a'],
      description: '实验观察：17天的小样本仍然不足以证明所有情况，应保留不确定性。',
    }),
  );
  const b = saveRecord(
    db,
    knowledgeForm('样本修正结论', {
      directory_id: other.id,
      original_date: '2026-09-20',
      tags: ['tag-b'],
      domains: ['domain-b'],
      collections: ['topic-b'],
      description: '实验后修正：新增样本与旧观察存在冲突，需要记录不同阶段并继续验证。',
    }),
  );
  const source = addSource(db, {
    kind: 'report',
    title: '合成周报来源',
    excerpt: '实验观察有17天小样本，结论待验证。',
    original_date: '2026-09-01',
  });
  db.prepare('INSERT INTO knowledge_entry_sources VALUES(?,?,?)').run(a.id, source, '');
  const tool = saveEntry(db, {
    ...fixtureForm,
    type: 'note',
    resource_kind: 'tool',
    tool_kind: 'online',
    url: '',
    title: '实验分析工具',
  });
  const bare = saveEntry(db, {
    ...fixtureForm,
    title: '实验视频网址',
    description: '',
    content: '',
  });
  for (const [id, text] of [
    ['topic-a', '原专题知识总结'],
    ['topic-b', '目标专题判断保留'],
  ])
    db.prepare('INSERT INTO collection_documents VALUES(?,?,?,?,?,?)').run(
      id,
      '实验介绍',
      '<p>' + text + '</p>',
      '[]',
      1,
      new Date().toISOString(),
    );
  return { root, other, child, page, a, b, source, tool, bare };
}
export function assistantResponse(payload) {
  if (payload.mode === 'assistant_qa')
    return {
      status: 'ready',
      answer: [
        {
          text: '资料记录了实验范围和待验证事项。',
          basis: 'evidence',
          sourceIds: payload.sources
            .filter((s) => s.hasEvidence)
            .slice(0, 2)
            .map((s) => s.key),
        },
        {
          text: '后续可能需要更大样本；这是推断。',
          basis: 'inference',
          sourceIds: payload.sources
            .filter((s) => s.hasEvidence)
            .slice(0, 1)
            .map((s) => s.key),
        },
      ],
      missing: ['尚无证明普遍适用的证据。'],
    };
  if (payload.mode === 'assistant_structure') {
    const a = payload.sources.find((s) => s.kind === 'tags' && s.id === 'tag-a'),
      b = payload.sources.find((s) => s.kind === 'tags' && s.id === 'tag-b');
    return {
      status: 'ready',
      suggestions:
        a && b
          ? [
              {
                object: a.key,
                target: b.key,
                kind: 'tags',
                action: 'merge',
                name: '',
                reason: '标准化名称相同，建议人工核对后合并。',
                evidenceIds: [a.key, b.key],
              },
            ]
          : payload.sources
              .filter((s) => s.kind === 'directories')
              .slice(0, 1)
              .map((s) => ({
                object: s.key,
                target: '',
                kind: s.kind,
                action: 'rename',
                name: '研究资料',
                reason: '仅在人工确认含义后改善名称。',
                evidenceIds: [s.key],
              })),
      missing: [],
    };
  }
  return integrationPlan(payload.sources);
}

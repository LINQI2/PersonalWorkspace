import { fixtureForm } from './ai-fixture.js';
export const readingPackage = () => ({
  format: 'personal-knowledge-exchange',
  version: 1,
  sources: [
    {
      id: 'source',
      kind: 'chatgpt',
      title: '合成研究来源',
      excerpt: '合成资料：实验需要保留不同观点和来源，不能把相关当作重复。',
      original_date: '2026-09-01',
    },
  ],
  directories: [{ id: 'research', name: '合成研究' }],
  items: [
    {
      id: 'page',
      kind: 'page',
      title: '模拟研究阅读页',
      body: '概览：实验范围、不同观点和待验证事项。',
      directory: 'research',
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: 'point-' + i,
      kind: 'point',
      parent: i === 8 ? 'point-7' : 'page',
      title: '研究章节 ' + (i + 1),
      body:
        '这是第 ' +
        (i + 1) +
        ' 个合成知识点。实验需要保留不同观点和来源，不能把相关当作重复。独特关键词章节' +
        (i + 1),
      directory: 'research',
      original_date: '2026-09-01',
      references: [{ source_id: 'source', quote: '实验需要保留不同观点和来源' }],
    })),
  ],
});
export const knowledgeForm = (title, patch = {}) => ({
  ...fixtureForm,
  type: 'note',
  url: '',
  title,
  kind: 'point',
  status: 'review',
  epistemic: 'ai_inference',
  priority: 0,
  questions: '',
  directory_id: null,
  references: [],
  ...patch,
});
export const integrationPlan = (sources) => ({
  status: 'ready',
  reason: '两份合成资料互补，仍待验证。',
  keepIds: sources.map((s) => s.id),
  order: sources.map((s) => s.id),
  sections: [
    {
      title: '审查后的合成章节',
      text: '保留实验范围、不同观点与未验证事项。',
      sourceIds: sources.map((s) => s.id),
    },
  ],
  relations: [
    {
      kind: 'complement',
      from: sources[0].id,
      to: sources[1].id,
      reason: '相同实验原则，分别有补充观察。',
      fromQuote: sources[0].text.slice(0, 30),
      toQuote: sources[1].text.slice(0, 30),
    },
  ],
  verification: ['样本范围未验证。'],
});

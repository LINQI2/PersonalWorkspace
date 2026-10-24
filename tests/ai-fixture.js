export const fixtureKey = 'test-only-not-a-real-api-key';
export const deepSeekFixtureKey = 'test-only-not-a-real-deepseek-key';
export function deepSeekFixtureResponse(
  value,
  usage = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    prompt_cache_hit_tokens: 100,
    prompt_cache_miss_tokens: 900,
  },
  finish = 'stop',
) {
  return Response.json({
    choices: [
      { finish_reason: finish, message: { role: 'assistant', content: JSON.stringify(value) } },
    ],
    usage,
  });
}
export const fixtureForm = {
  type: 'bookmark',
  title: '人工原标题',
  url: 'https://www.zhihu.com/question/private-id',
  description: '这是一份关于前端界面布局的实践记录，讨论清晰信息层级、可读性和具体实现的取舍。',
  content:
    '<h2>原文标题</h2><p><strong>重要事实</strong>：实验用了 17 天，成本 320 元；目前不能确定结果。</p><ul><li>保留原有判断</li></ul>',
  domains: [],
  tags: [],
  collections: [],
  cover_asset_id: null,
  pinned: 0,
};
export function fixtureSuggestion(payload) {
  return {
    status: 'ready',
    title: '界面布局的实践记录',
    summary: '关于信息层级与可读性的实践总结。',
    reason: '正文包含界面布局，推荐现有开发领域；请人工复核。',
    domains: payload.taxonomy.domains.slice(0, 1).map((t) => t.id),
    tags: payload.taxonomy.tags.slice(0, 1).map((t) => t.id),
    collections: payload.taxonomy.collections.slice(0, 1).map((t) => t.id),
    newTags: ['布局实践'],
    points: ['实验 17 天，成本 320 元，结果仍不确定。'],
    sections:
      payload.mode === 'note'
        ? [
            {
              heading: '实践记录',
              paragraphs: ['实验 17 天，成本 320 元；仍无法确定结果。'],
              points: ['保留原有判断。'],
            },
          ]
        : [],
  };
}
export function fixtureResponse(
  value,
  usage = { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 100 } },
) {
  return Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage,
  });
}

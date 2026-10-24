export type ShareResult = { urls: string[]; title: string; tags: string[] };
const trimUrl = (raw: string) => {
  let value = raw.replace(/[，。！？；：、,.!?;:》】”’]+$/u, '');
  for (const [open, close] of [
    ['(', ')'],
    ['（', '）'],
    ['[', ']'],
  ])
    while (value.endsWith(close) && value.split(close).length > value.split(open).length)
      value = value.slice(0, -1);
  return value;
};
export function parseShareText(raw: string): ShareResult {
  if (raw.length > 20000) throw Error('分享文字超过 20000 字，请减少本次粘贴内容。');
  const matches = [...raw.matchAll(/https?:\/\/[^\s<>"“”‘’]+/giu)];
  const urls: string[] = [],
    seen = new Set<string>();
  for (const match of matches) {
    const value = trimUrl(match[0]);
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        value.length > 4096
      )
        continue;
      const identity = new URL(url);
      identity.hash = '';
      if (!seen.has(identity.href)) {
        urls.push(value);
        seen.add(identity.href);
      }
    } catch {
      /* A candidate is not a validated source page. */
    }
  }
  const withoutUrls = raw.replace(/https?:\/\/[^\s<>"“”‘’]+/giu, ' ');
  const tags = [
    ...new Set([...withoutUrls.matchAll(/#\s*([\p{L}\p{N}_\-·]{1,50})/gu)].map((m) => m[1])),
  ].slice(0, 10);
  let title = withoutUrls
    .replace(/#\s*[\p{L}\p{N}_\-·]+/gu, ' ')
    .replace(
      /(?:复制(?:此)?链接|复制口令|打开(?:Dou音|抖音|小红书|快手).*?(?:搜索|观看)|点击链接(?:查看|观看)).*$/isu,
      '',
    )
    .replace(/^\s*\d+(?:\.\d+)?\s+/u, '')
    .trim();
  // Share-code/date noise preceding a Chinese sentence is a title heuristic, never verified content.
  const han = title.search(/\p{Script=Han}/u);
  if (han > 0 && /[:/@]|\d{1,2}\/\d{1,2}/u.test(title.slice(0, han))) title = title.slice(han);
  title = title
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：|｜]+|[\s:：|｜]+$/gu, '')
    .slice(0, 200);
  return { urls, title, tags };
}

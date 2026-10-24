// Restricted, versioned interchange. Never pass arbitrary library JSON to the renderer.
export const mapFormat = 'personal-knowledge-mindmap';
const fail = () => {
  throw Error('思维导图格式无效：请检查节点、层级、连线和安全字段。');
};
const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allowed) => {
  if (!obj(x) || Object.keys(x).some((k) => !allowed.includes(k))) fail();
};
const text = (x, n) => {
  if (typeof x !== 'string' || x.length > n || !x.trim()) fail();
  return x;
};
const id = (x) => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(x);
const uuid = (x) => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x);
export function validateMap(value) {
  if (!obj(value)) fail();
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 750000)
    throw Error('导图超过750 KB限制。');
  keys(value, ['nodeData', 'arrows', 'direction', 'compact', 'appearance']);
  if (value.appearance !== undefined && !['light', 'dark'].includes(value.appearance)) fail();
  if (![0, 1, 2, 3].includes(value.direction) || typeof value.compact !== 'boolean') fail();
  const ids = new Set(),
    targets = new Set();
  const visit = (n, depth) => {
    keys(n, [
      'id',
      'topic',
      'children',
      'expanded',
      'direction',
      'style',
      'branchColor',
      'metadata',
    ]);
    if (!id(n.id) || ids.has(n.id) || depth > 12 || ids.size >= 500) fail();
    ids.add(n.id);
    text(n.topic, 2000);
    if (n.expanded !== undefined && typeof n.expanded !== 'boolean') fail();
    if (n.direction !== undefined && ![0, 1].includes(n.direction)) fail();
    if (
      n.branchColor !== undefined &&
      (typeof n.branchColor !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(n.branchColor))
    )
      fail();
    if (n.style !== undefined) {
      keys(n.style, ['color', 'background', 'fontWeight']);
      for (const [k, v] of Object.entries(n.style))
        if (
          k === 'fontWeight'
            ? !['normal', 'bold'].includes(v)
            : typeof v !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(v)
        )
          fail();
    }
    if (n.metadata !== undefined) {
      keys(n.metadata, ['contentId']);
      if (!uuid(n.metadata.contentId)) fail();
      targets.add(n.metadata.contentId);
    }
    if (n.children !== undefined) {
      if (!Array.isArray(n.children)) fail();
      n.children.forEach((c) => visit(c, depth + 1));
    }
  };
  visit(value.nodeData, 0);
  if (!Array.isArray(value.arrows) || value.arrows.length > 500) fail();
  const arrows = new Set(),
    pairs = new Set();
  for (const a of value.arrows) {
    keys(a, ['id', 'from', 'to', 'label', 'bidirectional', 'delta1', 'delta2']);
    const pair = a.from + '|' + a.to;
    if (
      !id(a.id) ||
      arrows.has(a.id) ||
      pairs.has(pair) ||
      a.from === a.to ||
      !ids.has(a.from) ||
      !ids.has(a.to)
    )
      fail();
    arrows.add(a.id);
    pairs.add(pair);
    if (typeof a.label !== 'string' || a.label.length > 200 || typeof a.bidirectional !== 'boolean')
      fail();
    for (const k of ['delta1', 'delta2'])
      if (a[k] !== undefined) {
        keys(a[k], ['x', 'y']);
        if (![a[k].x, a[k].y].every((n) => Number.isFinite(n) && Math.abs(n) <= 100000)) fail();
      }
  }
  return { count: ids.size, targets: [...targets] };
}
export function mapNodes(data) {
  const rows = [];
  const walk = (n, parent = null, depth = 0) => {
    rows.push({ node: n, parent, depth });
    (n.children || []).forEach((c) => walk(c, n, depth + 1));
  };
  walk(data.nodeData);
  return rows;
}
export function mapMarkdown(data, title) {
  return (
    '# ' +
    title.replace(/[\r\n]/g, ' ') +
    '\n\n' +
    mapNodes(data)
      .map(
        ({ node, depth }) =>
          '  '.repeat(depth) +
          '- ' +
          node.topic.replace(/[\r\n]/g, ' ') +
          (node.metadata?.contentId ? ' [站内知识](#content-' + node.metadata.contentId + ')' : ''),
      )
      .join('\n') +
    '\n\n<!-- Markdown仅包含文字大纲与知识ID；样式、折叠和跨分支连线请使用JSON保留。 -->\n'
  );
}
export function newMap(title = '中心主题') {
  return {
    nodeData: { id: crypto.randomUUID(), topic: title, expanded: true, children: [] },
    arrows: [],
    direction: 2,
    compact: false,
    appearance: 'light',
  };
}

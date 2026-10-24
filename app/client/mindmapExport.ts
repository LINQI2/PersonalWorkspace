import type MindElixir from 'mind-elixir';
// Preserve the engine's geometry, replace its innerHTML-based text conversion
// with safe text nodes positioned from the actual rendered diagram.
export async function exportMindmap(m: MindElixir, kind: 'svg' | 'png'): Promise<Blob> {
  // The vendor converter assigns topic text to SVG innerHTML. Escape before it
  // runs (not merely after parsing), freezing measured spans to keep geometry.
  const spans = [...m.nodes.querySelectorAll<HTMLElement>('me-tpc>.text')]
    .filter((el) => /[&<>]/.test(el.textContent || ''))
    .map((el) => ({
      el,
      text: el.textContent || '',
      style: el.style.cssText,
      width: getComputedStyle(el).width,
      height: getComputedStyle(el).height,
    }));
  let generated: Blob;
  try {
    for (const s of spans) {
      s.el.style.width = s.width;
      s.el.style.height = s.height;
      s.el.style.overflow = 'hidden';
      s.el.textContent = s.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    generated = m.exportSvg(true);
  } finally {
    for (const s of spans) {
      s.el.textContent = s.text;
      s.el.style.cssText = s.style;
    }
  }
  const raw = await generated!.text();
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml'),
    svg = doc.documentElement;
  if (svg.localName !== 'svg' || doc.querySelector('parsererror'))
    throw Error('导图SVG生成失败，请导出JSON。');
  for (const el of [...svg.querySelectorAll('*')]) {
    if (
      ![
        'svg',
        'g',
        'path',
        'rect',
        'defs',
        'marker',
        'polygon',
        'polyline',
        'circle',
        'line',
        'ellipse',
      ].includes(el.localName)
    ) {
      el.remove();
      continue;
    }
    for (const a of [...el.attributes])
      if (a.name.startsWith('on') || /href|style/i.test(a.name)) el.removeAttribute(a.name);
  }
  const plot = svg.lastElementChild;
  if (!plot || plot.localName !== 'svg') throw Error('导出结构无效。');
  const base = m.nodes.getBoundingClientRect(),
    scale = base.width / m.nodes.offsetWidth || 1;
  const measure = document.createElement('canvas').getContext('2d')!;
  const add = (el: HTMLElement) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el),
      font = parseFloat(s.fontSize) || 16,
      line = parseFloat(s.lineHeight) || font * 1.5;
    const width = Math.max(
      20,
      r.width / scale - parseFloat(s.paddingLeft || '0') - parseFloat(s.paddingRight || '0'),
    );
    measure.font = s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
    const lines: string[] = [];
    for (const paragraph of (el.textContent || '').split('\n')) {
      let text = '';
      for (const char of paragraph) {
        if (text && measure.measureText(text + char).width > width + 1) {
          lines.push(text);
          text = '';
        }
        text += char;
      }
      lines.push(text);
    }
    const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('font-family', s.fontFamily);
    text.setAttribute('font-size', s.fontSize);
    text.setAttribute('font-weight', s.fontWeight);
    text.setAttribute('fill', s.color);
    lines.forEach((value, i) => {
      const span = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      span.setAttribute(
        'x',
        String((r.left - base.left) / scale + parseFloat(s.paddingLeft || '0')),
      );
      span.setAttribute(
        'y',
        String(
          (r.top - base.top) / scale +
            parseFloat(s.paddingTop || '0') +
            font +
            (line - font) / 2 +
            i * line,
        ),
      );
      span.textContent = value;
      text.appendChild(span);
    });
    plot.appendChild(text);
  };
  m.nodes.querySelectorAll<HTMLElement>('me-tpc>.text').forEach(add);
  m.labelContainer.querySelectorAll<HTMLElement>('[data-type="arrow"]').forEach(add);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  if (kind === 'svg') return blob;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('无法读取导出图像。'));
    reader.readAsDataURL(blob);
  });
  const image = new Image();
  image.src = data;
  await image.decode();
  if (image.width > 16384 || image.height > 16384 || image.width * image.height > 64000000)
    throw Error('PNG尺寸超过安全限制，请折叠部分分支或导出SVG/JSON。');
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error('PNG生成失败，请导出SVG/JSON。'))),
      'image/png',
    ),
  );
}

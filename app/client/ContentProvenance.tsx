import { useState } from 'react';
import { KnowledgeLinks } from './KnowledgeLinks';
import { type Entry } from './shared';
import { knowledgeWrite, epistemicLabels, stateLabels } from './knowledgeTypes';
export function ContentProvenance({
  entry,
  onOpen,
  onChanged,
}: {
  entry: Entry;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [raw, setRaw] = useState(''),
    [error, setError] = useState('');
  const p = entry.provenance;
  if (!p?.record && !p?.sources?.length) return null;
  return (
    <details className="knowledge-source-box">
      <summary>来源与原始导入记录</summary>
      <p>
        {epistemicLabels[p.record?.epistemic as keyof typeof epistemicLabels] ||
          p.record?.epistemic}{' '}
        / {stateLabels[p.record?.status as keyof typeof stateLabels] || p.record?.status} · 原始日期{' '}
        {p.record?.original_date || '未知'} · 资料记录时间{' '}
        {p.record?.provided_recorded_at || '未知'}
      </p>
      <p className="muted">来源由用户提供，未抓取验证；AI推断不代表人工确认。</p>
      {p.sources.map((s: any) => (
        <details key={s.id}>
          <summary>{s.title}</summary>
          <blockquote>{s.quote}</blockquote>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.excerpt}</pre>
          {s.url && (
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              来源网址
            </a>
          )}
        </details>
      ))}
      {p.record && (
        <button
          onClick={() =>
            knowledgeWrite('/import/source', 'POST', { id: p.record.batch_id })
              .then((b) => setRaw(b.raw_input))
              .catch((e) => setError(e.message))
          }
        >
          查看原始导入包
        </button>
      )}
      {raw && (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxHeight: 400,
            overflow: 'auto',
          }}
        >
          {raw}
        </pre>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

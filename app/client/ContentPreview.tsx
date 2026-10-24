import { Dialog, Cover, source } from './components';
import { useEffect } from 'react';
import { ContentActions, contentKind } from './Experience';
import { type Entry } from './shared';
import { ContentProvenance } from './ContentProvenance';
import { RelatedPanel } from './RelatedPanel';
export function ContentPreview({
  entry,
  onClose,
  onRead,
  onEdit,
  onChanged,
  onOpen,
}: {
  entry: Entry;
  onClose: () => void;
  onRead: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  useEffect(() => {
    if (location.hash !== '#preview-' + entry.id)
      history.pushState({ pkPreview: true }, '', '#preview-' + entry.id);
  }, [entry.id]);
  const close = () => {
    if (location.hash === '#preview-' + entry.id) {
      if (history.state?.pkPreview) history.back();
      else history.replaceState(null, '', location.pathname + location.search);
    }
    onClose();
  };
  return (
    <Dialog title="内容预览" onClose={close} wide>
      <div className="content-preview">
        <div className="preview-title">
          {entry.resource_kind === 'tool' && <Cover entry={entry} />}
          <div>
            <small>
              {contentKind(entry)} · {source(entry)}
            </small>
            <h2>{entry.title}</h2>
          </div>
        </div>
        <div className="preview-actions">
          <button className="primary" onClick={onRead}>
            完整阅读
          </button>
          <button
            onClick={() => {
              if (location.hash.startsWith('#preview-'))
                history.replaceState(null, '', location.pathname + location.search);
              onEdit();
            }}
          >
            编辑
          </button>
          <ContentActions entry={entry} onChanged={onChanged} />
        </div>
        {entry.url && (
          <a className="source-link" href={entry.url} target="_blank" rel="noopener noreferrer">
            打开原网站 ↗
          </a>
        )}
        <p>{entry.description}</p>
        <div className="chips">
          {entry.domains.map((d) => (
            <span key={d.id}>{d.name}</span>
          ))}
          {entry.tags.map((t) => (
            <span key={t.id}>#{t.name}</span>
          ))}
        </div>
        <small>仅展示本地保存内容；来源网址未抓取或验证。</small>
        {entry.content && (
          <div
            className="prose preview-prose"
            dangerouslySetInnerHTML={{ __html: entry.content }}
          />
        )}
        <ContentProvenance entry={entry} onOpen={onOpen} onChanged={onChanged} />
        <RelatedPanel id={entry.id} onOpen={onOpen} onChanged={onChanged} />
      </div>
    </Dialog>
  );
}

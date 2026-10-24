export function AiReviewItem({
  title,
  before,
  after,
  reason,
  affected,
  contentChange = false,
  relationChange = false,
  children,
}: {
  title: string;
  before: string;
  after: string;
  reason: string;
  affected: number;
  contentChange?: boolean;
  relationChange?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="knowledge-review-item ai-review-item">
      <h3>{title}</h3>
      <div className="review-diff">
        <div>
          <small>原状态</small>
          <p>{before}</p>
        </div>
        <div>
          <small>建议状态</small>
          <p>{after}</p>
        </div>
      </div>
      <p>{reason}</p>
      <small>
        直接关联 {affected} 个对象 · {contentChange ? '内容变更' : '原内容保留'} ·{' '}
        {relationChange ? '关系变更' : '关系保留'} · AI 候选，尚未正式保存
      </small>
      {children}
    </section>
  );
}

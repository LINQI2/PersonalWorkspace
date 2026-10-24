import { RelatedPanel } from './RelatedPanel';
export function KnowledgeLinks({
  id,
  onOpen,
  onChanged,
}: {
  id: string;
  relations: any[];
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  return <RelatedPanel id={id} onOpen={onOpen} onChanged={onChanged} />;
}

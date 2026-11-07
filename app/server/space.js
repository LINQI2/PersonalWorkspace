export function spaceSql(db, space = 'personal', alias = 'e') {
  if (!['personal', 'professional', 'all'].includes(space)) throw Error('知识空间无效。');
  if (db.prepare('PRAGMA user_version').get().user_version < 12) return space === 'professional' ? '0' : '1';
  const exists = `EXISTS(SELECT 1 FROM professional_entries pe WHERE pe.entry_id=${alias}.id)`;
  return space === 'all' ? '1' : space === 'professional' ? exists : `NOT ${exists}`;
}

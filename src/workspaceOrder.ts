export function moveRepository(ids: string[], source: string, target: string) {
  if (source === target) return ids;

  const next = [...ids];
  const sourceIndex = next.indexOf(source);
  const targetIndex = next.indexOf(target);

  if (sourceIndex < 0 || targetIndex < 0) return ids;

  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

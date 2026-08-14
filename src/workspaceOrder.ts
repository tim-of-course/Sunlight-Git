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

export function moveRepositoryToIndex(ids: string[], source: string, index: number) {
  const sourceIndex = ids.indexOf(source);
  if (sourceIndex < 0) return ids;

  const nextIndex = Math.max(0, Math.min(index, ids.length - 1));
  if (sourceIndex === nextIndex) return ids;

  const next = [...ids];
  next.splice(sourceIndex, 1);
  next.splice(nextIndex, 0, source);
  return next;
}

export function reorderIndexFromPointer(
  clientY: number,
  items: { top: number; height: number }[]
) {
  if (items.length === 0) return 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (clientY < item.top + item.height / 2) return index;
  }

  return items.length - 1;
}

// Older PDF anchors stored only printed rectangles. Allow one PDF point of
// rendering drift on each edge, accounting for reversed corners after rotation.
function samePrintedRect(a, b) {
  return [0, 1].every(i =>
    Math.abs(Math.min(a[i], a[i + 2]) - Math.min(b[i], b[i + 2])) <= 1 &&
    Math.abs(Math.max(a[i], a[i + 2]) - Math.max(b[i], b[i + 2])) <= 1);
}

export function findPassage(entries, source) {
  const location = source.location;
  const candidates = entries.filter(item => item.selection === source.selection);
  if (location.kind !== 'pdf') return candidates.find(item => JSON.stringify(item.location) === JSON.stringify(location));
  const onPage = candidates.filter(item => item.location.kind === 'pdf' && item.location.page === location.page);
  if (location.textOffset !== undefined) {
    const exact = onPage.find(item => item.location.textOffset === location.textOffset);
    if (exact) return exact;
  }
  const matches = onPage.filter(({ location: saved }) =>
    (location.textOffset === undefined || saved.textOffset === undefined) &&
    samePrintedRect(saved.rects[0], location.rects[0]) && samePrintedRect(saved.rects.at(-1), location.rects.at(-1)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const exact = matches.filter(item => JSON.stringify(item.location.rects) === JSON.stringify(location.rects));
    if (exact.length === 1) return exact[0];
  }
}

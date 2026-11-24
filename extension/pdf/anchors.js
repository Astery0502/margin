export function viewportRects(location, pageView) {
  return location.rects.map(rect => {
    const [x1, y1] = pageView.viewport.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = pageView.viewport.convertToViewportPoint(rect[2], rect[3]);
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  });
}

export function pdfLocation(range, layer, pageView) {
  const prefix = range.cloneRange();
  prefix.selectNodeContents(layer);
  prefix.setEnd(range.startContainer, range.startOffset);
  const textOffset = prefix.toString().length;
  const { viewport } = pageView;
  const bounds = layer.getBoundingClientRect();
  const rects = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node)) continue;
    const fragment = document.createRange();
    fragment.setStart(node, node === range.startContainer ? range.startOffset : 0);
    fragment.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
    for (const rect of fragment.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const point = (x, y) => viewport.convertToPdfPoint((x - bounds.left) * viewport.width / bounds.width, (y - bounds.top) * viewport.height / bounds.height);
      rects.push([...point(rect.left, rect.top), ...point(rect.right, rect.bottom)]);
    }
  }
  return { kind: 'pdf', page: pageView.id, textOffset, rects };
}

function markdownMath(Tokenizer, renderer) {
  const displayStart = /^[ \t]{0,3}(?:\$\$|\\\[)/m;
  return {
    tokenizer: {
      lheading(source) {
        const heading = Tokenizer.prototype.lheading.call(this, source);
        // A formula's standalone equals sign is not a Markdown heading underline.
        if (heading && displayStart.test(heading.raw)) return;
        return heading;
      },
    },
    extensions: [{
      name: 'displayMath', level: 'block',
      start: source => source.search(displayStart),
      tokenizer(source) {
        const match = /^[ \t]{0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:[ \t]*(?:\n|$))/.exec(source);
        if (match) return { type: 'displayMath', raw: match[0], text: match[1] ?? match[2], display: true };
      },
      renderer,
    }, {
      name: 'math', level: 'inline',
      start: source => source.search(/\$|\\[([]/),
      tokenizer(source) {
        const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$((?:\\[^\n]|[^\\\n$])+?)\$)/.exec(source);
        if (match) return { type: 'math', raw: match[0], text: match[1] ?? match[2] ?? match[3] ?? match[4], display: match[1] !== undefined || match[2] !== undefined };
      },
      renderer,
    }],
  };
}

if (typeof module === 'undefined') globalThis.PiMarkdownMath = markdownMath;
else module.exports = markdownMath;

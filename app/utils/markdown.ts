import MarkdownIt from "markdown-it";

const parser = new MarkdownIt({ html: false });

const INLINE_TEXT_TOKENS = new Set(["text", "code_inline"]);
const INLINE_BREAK_TOKENS = new Set(["softbreak", "hardbreak"]);

export function markdownToPlainText(source: string): string {
  const words: string[] = [];
  for (const block of parser.parse(source, {})) {
    if (block.type === "code_block" || block.type === "fence") {
      words.push(block.content);
    }
    for (const token of block.children ?? []) {
      if (INLINE_TEXT_TOKENS.has(token.type)) words.push(token.content);
      if (INLINE_BREAK_TOKENS.has(token.type)) words.push(" ");
    }
    if (block.type === "inline") words.push(" ");
  }
  return words.join("").replace(/\s+/g, " ").trim();
}

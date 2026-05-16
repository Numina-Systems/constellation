// pattern: Functional Core

export function stripQuotedContent(text: string): string {
  let result = text;
  // Remove fenced code blocks (```...```)
  result = result.replace(/```[\s\S]*?```/g, '');
  // Remove blockquotes (lines starting with optional whitespace then >)
  result = result.replace(/^\s*>.*$/gm, '');
  // Collapse multiple newlines
  result = result.replace(/\n{2,}/g, '\n');
  return result.trim();
}

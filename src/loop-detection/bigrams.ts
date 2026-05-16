// pattern: Functional Core

export function tokenBigrams(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length < 2) return new Set(tokens.length === 1 ? [tokens[0]!] : []);
  const bigrams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

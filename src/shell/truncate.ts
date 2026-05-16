// pattern: Functional Core

export function truncateOutput(raw: string, maxBytes: number): string {
  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (byteLength <= maxBytes) {
    return raw;
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(raw);
  const truncated = encoded.slice(0, maxBytes);
  const decoder = new TextDecoder('utf-8', {fatal: false});
  const result = decoder.decode(truncated);

  return `${result}\n[truncated — ${byteLength} bytes total]`;
}

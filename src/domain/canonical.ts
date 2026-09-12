const encoder = new TextEncoder();
const blockedKeys = new Set(['__proto__', 'constructor', 'prototype']);

export const maximumRequestBytes = 32768;
export const maximumJsonNesting = 12;

function dict(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function assertSafeKey(key: string): void {
  if (blockedKeys.has(key)) throw new Error('invalid JSON key');
}

export function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output = dict();
    for (const key of Object.keys(input).sort()) {
      assertSafeKey(key);
      output[key] = sorted(input[key]);
    }
    return output;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value));
}

export function canonicalRequest(
  operation: string,
  projectId: string,
  args: unknown,
): string {
  if (typeof operation !== 'string' || operation.length === 0)
    throw new Error('invalid operation');
  return canonicalJson({
    args,
    operation,
    project_id: projectId,
  });
}

export async function hashRequest(canonical: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(canonical)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function parseBoundedJson(
  text: string,
  maxBytes = maximumRequestBytes,
): unknown {
  if (typeof text !== 'string') throw new Error('invalid JSON');
  if (encoder.encode(text).byteLength > maxBytes)
    throw new Error('request exceeds 32 KiB');
  const parser = new JsonParser(text);
  const value = parser.parseValue(1);
  parser.finish();
  return value;
}

class JsonParser {
  private index = 0;

  constructor(private readonly text: string) {}

  finish(): void {
    this.skipWs();
    if (this.index !== this.text.length) throw new Error('invalid JSON');
  }

  parseValue(depth: number): unknown {
    if (depth > maximumJsonNesting) throw new Error('JSON nesting exceeds 12');
    this.skipWs();
    const next = this.text[this.index];
    if (next === '{') return this.parseObject(depth);
    if (next === '[') return this.parseArray(depth);
    if (next === '"') return this.parseString();
    return this.parseLiteral();
  }

  private skipWs(): void {
    while (this.index < this.text.length) {
      const ch = this.text[this.index];
      if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') return;
      this.index += 1;
    }
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    const result = dict();
    const keys = new Set<string>();
    this.skipWs();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return result;
    }
    for (;;) {
      this.skipWs();
      if (this.text[this.index] !== '"') throw new Error('invalid JSON');
      const key = this.parseString();
      assertSafeKey(key);
      if (keys.has(key)) throw new Error('duplicate JSON key');
      keys.add(key);
      this.skipWs();
      if (this.text[this.index] !== ':') throw new Error('invalid JSON');
      this.index += 1;
      result[key] = this.parseValue(depth + 1);
      this.skipWs();
      const ch = this.text[this.index];
      if (ch === ',') {
        this.index += 1;
        continue;
      }
      if (ch === '}') {
        this.index += 1;
        return result;
      }
      throw new Error('invalid JSON');
    }
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWs();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return result;
    }
    for (;;) {
      result.push(this.parseValue(depth + 1));
      this.skipWs();
      const ch = this.text[this.index];
      if (ch === ',') {
        this.index += 1;
        continue;
      }
      if (ch === ']') {
        this.index += 1;
        return result;
      }
      throw new Error('invalid JSON');
    }
  }

  private parseString(): string {
    const start = this.index;
    if (this.text[this.index] !== '"') throw new Error('invalid JSON');
    this.index += 1;
    while (this.index < this.text.length) {
      const ch = this.text[this.index];
      if (ch === '\\') {
        const next = this.text[this.index + 1];
        if (next === 'u') this.index += 6;
        else this.index += 2;
        continue;
      }
      if (ch === '"') {
        const raw = this.text.slice(start, this.index + 1);
        this.index += 1;
        return JSON.parse(raw) as string;
      }
      this.index += 1;
    }
    throw new Error('invalid JSON');
  }

  private parseLiteral(): unknown {
    const match = this.text
      .slice(this.index)
      .match(/^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match?.[1]) throw new Error('invalid JSON');
    this.index += match[1].length;
    return JSON.parse(match[1]) as unknown;
  }
}

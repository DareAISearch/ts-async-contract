import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyHash, canonicalJson, isValidIdempotencyKey } from '../src/idempotency.js';

interface Vector {
  name: string;
  json: string;
  canonical: string;
  sha256: string;
}

// Shared byte-for-byte with py-async-contract's tests/fixtures, so both implementations must agree.
const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/body_hash_vectors.json', import.meta.url), 'utf-8')
) as Vector[];

describe('isValidIdempotencyKey', () => {
  it.each(['a', 'scrape-42', 'job_1.attempt:2', 'A-Za-z0-9._:-', 'x'.repeat(255)])('accepts %j', (key) => {
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    'x'.repeat(256),
    'has space',
    'slash/',
    'tab\t',
    'trailing\n',
    'ünicode',
    'a,b',
  ])('rejects %j', (key) => {
    expect(isValidIdempotencyKey(key)).toBe(false);
  });
});

describe('canonicalJson', () => {
  it.each(vectors.map((v) => [v.name, v] as const))('matches shared vector: %s', (_name, vector) => {
    const value: unknown = JSON.parse(vector.json);
    expect(canonicalJson(value)).toBe(vector.canonical);
    expect(bodyHash(value)).toBe(vector.sha256);
  });

  it('hashes the same body in any key order the same', () => {
    expect(bodyHash({ a: 1, b: { c: [1, 2], d: null } })).toBe(bodyHash({ b: { d: null, c: [1, 2] }, a: 1 }));
  });

  it('hashes different bodies differently, including an explicit null vs an absent field', () => {
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }));
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 1, b: null }));
  });

  it('treats undefined like JSON.stringify does, so the hash matches what is actually sent', () => {
    const body = { a: 1, b: undefined, c: [1, undefined] };
    expect(canonicalJson(body)).toBe(canonicalJson(JSON.parse(JSON.stringify(body))));
    expect(canonicalJson(body)).toBe('{"a":1,"c":[1,null]}');
  });

  it('accepts objects with a null prototype', () => {
    const value = Object.assign(Object.create(null) as Record<string, unknown>, { b: 2, a: 1 });
    expect(canonicalJson(value)).toBe('{"a":1,"b":2}');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['bigint', 10n],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['nested NaN', { a: [Number.NaN] }],
  ])('throws TypeError for %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
});

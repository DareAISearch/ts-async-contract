import { createHash } from 'node:crypto';

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,255}$/;

/** True if `value` is 1-255 chars of [A-Za-z0-9._:-]. */
export function isValidIdempotencyKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_RE.test(value);
}

/**
 * Serialize a JSON value per RFC 8785 (JCS): sorted keys, no whitespace, ECMAScript number formatting.
 * Byte-identical to py-async-contract's canonical_json for the same JSON document.
 *
 * `undefined` is treated as JSON.stringify treats it (object properties dropped, array slots null), so
 * the hash matches what would actually be sent. Throws TypeError for anything else JSON can't
 * represent (NaN/Infinity, bigint, functions, symbols, non-plain objects such as Date).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`JSON can't represent ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`not a plain JSON object: ${proto?.constructor?.name ?? typeof value}`);
    }
    const record = value as Record<string, unknown>;
    // Default sort compares UTF-16 code units, which is exactly the order JCS requires.
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new TypeError(`not a JSON value: ${typeof value}`);
}

/**
 * sha256 hex digest of the canonical JSON of a parsed request body. The called service stores it with
 * the idempotency key to tell a genuine replay (same key, same body) from a key reused for other work.
 */
export function bodyHash(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

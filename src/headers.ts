// Hyphenated on purpose: nginx (and some other proxies) silently drop headers with underscores.
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const JOB_ID_HEADER = 'Job-Id';
export const LOCATION_HEADER = 'Location';
export const WEBHOOK_ID_HEADER = 'Webhook-Id';
export const WEBHOOK_TIMESTAMP_HEADER = 'Webhook-Timestamp';

/** A fetch `Headers`, or a plain record such as Fastify's `request.headers` / Node's IncomingHttpHeaders. */
export type HeaderSource = Headers | Record<string, string | string[] | undefined>;

/** Case-insensitive header lookup. A header repeated with different values reads as absent. */
export function getHeader(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;

  const lowered = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowered) continue;
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return value;
  }
  return undefined;
}

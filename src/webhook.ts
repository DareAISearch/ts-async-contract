import { InvalidWebhookHeadersError } from './errors.js';
import {
  getHeader,
  IDEMPOTENCY_KEY_HEADER,
  JOB_ID_HEADER,
  WEBHOOK_ID_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type HeaderSource,
} from './headers.js';
import { isValidIdempotencyKey } from './idempotency.js';

export type DeliveryOutcome = 'delivered' | 'retry' | 'permanent';

/** The contract headers on an incoming webhook. These, not the body, are authoritative. */
export interface WebhookHeaders {
  idempotencyKey: string;
  jobId: string;
  webhookId: string;
  timestamp: number;
}

export interface BuildWebhookHeadersInput {
  idempotencyKey: string;
  jobId: string;
  status: string;
  bearerToken?: string;
  /** Unix seconds; defaults to now. */
  timestamp?: number;
}

// --- called service (sends webhooks) ---

/** Id unique per webhook event (not per attempt), so receivers can drop duplicate deliveries. */
export function webhookId(jobId: string, status: string): string {
  return `${jobId}:${status}`;
}

/**
 * Headers for one delivery attempt. Build them again for each retry so Webhook-Timestamp reflects
 * the actual send time.
 */
export function buildWebhookHeaders(input: BuildWebhookHeadersInput): Record<string, string> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    [IDEMPOTENCY_KEY_HEADER]: input.idempotencyKey,
    [JOB_ID_HEADER]: input.jobId,
    [WEBHOOK_ID_HEADER]: webhookId(input.jobId, input.status),
    [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
  };
  if (input.bearerToken !== undefined) headers.Authorization = `Bearer ${input.bearerToken}`;
  return headers;
}

/**
 * What a webhook receiver's HTTP status means for delivery.
 *
 * 2xx: delivered. 5xx and 429: retry with backoff. Any other status: permanent failure, since resending
 * the same payload won't change the answer. A timeout or connection error has no status code; treat it
 * as "retry".
 */
export function classifyWebhookResponse(statusCode: number): DeliveryOutcome {
  if (statusCode >= 200 && statusCode < 300) return 'delivered';
  if (statusCode >= 500 || statusCode === 429) return 'retry';
  return 'permanent';
}

// --- calling service (receives webhooks) ---

/**
 * Validate and read the contract headers on an incoming webhook.
 *
 * Throws InvalidWebhookHeadersError (400). The sender treats a 400 as permanent, which is right here:
 * a delivery missing these headers won't grow them on retry.
 */
export function parseWebhookHeaders(headers: HeaderSource): WebhookHeaders {
  const idempotencyKey = getHeader(headers, IDEMPOTENCY_KEY_HEADER);
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new InvalidWebhookHeadersError(`${IDEMPOTENCY_KEY_HEADER} header is missing or invalid`);
  }
  const jobId = getHeader(headers, JOB_ID_HEADER);
  if (!jobId) throw new InvalidWebhookHeadersError(`${JOB_ID_HEADER} header is missing`);
  const eventId = getHeader(headers, WEBHOOK_ID_HEADER);
  if (!eventId) throw new InvalidWebhookHeadersError(`${WEBHOOK_ID_HEADER} header is missing`);
  const timestamp = getHeader(headers, WEBHOOK_TIMESTAMP_HEADER);
  if (!timestamp || !/^[0-9]+$/.test(timestamp)) {
    throw new InvalidWebhookHeadersError(`${WEBHOOK_TIMESTAMP_HEADER} header is missing or not unix seconds`);
  }
  return { idempotencyKey, jobId, webhookId: eventId, timestamp: Number(timestamp) };
}

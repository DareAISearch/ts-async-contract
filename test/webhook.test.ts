import { describe, expect, it } from 'vitest';
import { InvalidWebhookHeadersError } from '../src/errors.js';
import {
  buildWebhookHeaders,
  classifyWebhookResponse,
  parseWebhookHeaders,
  webhookId,
} from '../src/webhook.js';

function headers(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    'Idempotency-Key': 'scrape-42',
    'Job-Id': 'job-1',
    'Webhook-Id': 'job-1:COMPLETED',
    'Webhook-Timestamp': '1760000000',
    ...overrides,
  };
}

describe('webhookId', () => {
  it('is the job id and status', () => {
    expect(webhookId('job-1', 'COMPLETED')).toBe('job-1:COMPLETED');
  });

  it('differs per event of the same job', () => {
    expect(webhookId('job-1', 'PROCESSING')).not.toBe(webhookId('job-1', 'COMPLETED'));
  });
});

describe('buildWebhookHeaders', () => {
  it('sets every contract header', () => {
    expect(
      buildWebhookHeaders({
        idempotencyKey: 'scrape-42',
        jobId: 'job-1',
        status: 'COMPLETED',
        bearerToken: 'tok',
        timestamp: 17,
      })
    ).toEqual({
      'Idempotency-Key': 'scrape-42',
      'Job-Id': 'job-1',
      'Webhook-Id': 'job-1:COMPLETED',
      'Webhook-Timestamp': '17',
      Authorization: 'Bearer tok',
    });
  });

  it('omits Authorization without a token', () => {
    const built = buildWebhookHeaders({ idempotencyKey: 'k', jobId: 'j', status: 'FAILED', timestamp: 1 });
    expect(built).not.toHaveProperty('Authorization');
  });

  it('defaults the timestamp to now in unix seconds', () => {
    const before = Math.floor(Date.now() / 1000);
    const built = buildWebhookHeaders({ idempotencyKey: 'k', jobId: 'j', status: 'FAILED' });
    const timestamp = Number(built['Webhook-Timestamp']);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});

describe('classifyWebhookResponse', () => {
  it.each([200, 201, 202, 204, 299])('%i is delivered', (status) => {
    expect(classifyWebhookResponse(status)).toBe('delivered');
  });

  it.each([429, 500, 502, 503, 504])('%i is retried', (status) => {
    expect(classifyWebhookResponse(status)).toBe('retry');
  });

  it.each([400, 401, 403, 404, 409, 410, 422])('%i is permanent', (status) => {
    expect(classifyWebhookResponse(status)).toBe('permanent');
  });

  it.each([301, 302, 304])(
    '%i is permanent, since a followed redirect would drop the POST body',
    (status) => {
      expect(classifyWebhookResponse(status)).toBe('permanent');
    }
  );
});

describe('parseWebhookHeaders', () => {
  it('reads every contract header', () => {
    expect(parseWebhookHeaders(headers())).toEqual({
      idempotencyKey: 'scrape-42',
      jobId: 'job-1',
      webhookId: 'job-1:COMPLETED',
      timestamp: 1760000000,
    });
  });

  it('round-trips with buildWebhookHeaders', () => {
    const sent = buildWebhookHeaders({
      idempotencyKey: 'scrape-42',
      jobId: 'job-1',
      status: 'FAILED',
      timestamp: 5,
    });
    expect(parseWebhookHeaders(sent)).toEqual({
      idempotencyKey: 'scrape-42',
      jobId: 'job-1',
      webhookId: 'job-1:FAILED',
      timestamp: 5,
    });
  });

  it('reads lowercased headers and fetch Headers', () => {
    const lowered = Object.fromEntries(Object.entries(headers()).map(([k, v]) => [k.toLowerCase(), v]));
    expect(parseWebhookHeaders(lowered).jobId).toBe('job-1');
    expect(parseWebhookHeaders(new Headers(headers() as Record<string, string>)).jobId).toBe('job-1');
  });

  it.each(['Idempotency-Key', 'Job-Id', 'Webhook-Id', 'Webhook-Timestamp'])(
    'rejects a missing %s',
    (name) => {
      const err = captureError(() => parseWebhookHeaders(headers({ [name]: undefined })));
      expect(err).toBeInstanceOf(InvalidWebhookHeadersError);
      expect(err).toMatchObject({ statusCode: 400, code: 'invalid_webhook_headers' });
    }
  );

  it.each([
    { 'Idempotency-Key': 'bad key' },
    { 'Webhook-Timestamp': '-1' },
    { 'Webhook-Timestamp': '1.5' },
    { 'Webhook-Timestamp': 'soon' },
    { 'Webhook-Timestamp': '١٢٣' },
  ])('rejects malformed values: %j', (overrides) => {
    expect(() => parseWebhookHeaders(headers(overrides))).toThrow(InvalidWebhookHeadersError);
  });
});

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected an error');
}

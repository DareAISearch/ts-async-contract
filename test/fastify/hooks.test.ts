import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContractError, IdempotencyKeyConflictError } from '../../src/errors.js';
import { requireIdempotencyKey, requireWebhookHeaders, sendContractError } from '../../src/fastify/hooks.js';
import { acceptedHeaders } from '../../src/submit.js';
import { buildWebhookHeaders } from '../../src/webhook.js';

describe('Fastify hooks', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify();
    const seen = new Map<string, string>();

    app.post('/v1/jobs', { preHandler: requireIdempotencyKey }, async (request, reply) => {
      const key = request.idempotencyKey!;
      const body = JSON.stringify(request.body);
      try {
        if ((seen.get(key) ?? body) !== body) throw new IdempotencyKeyConflictError();
      } catch (err) {
        if (err instanceof ContractError) return sendContractError(reply, err);
        throw err;
      }
      seen.set(key, body);
      return reply.code(202).send({ key });
    });

    app.post('/webhook', { preHandler: requireWebhookHeaders }, async (request) => request.webhookHeaders);
  });

  describe('requireIdempotencyKey', () => {
    it('passes a valid key to the route', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: { 'Idempotency-Key': 'scrape-42' },
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ key: 'scrape-42' });
    });

    it('replies 400 when the key is missing', async () => {
      const response = await app.inject({ method: 'POST', url: '/v1/jobs', payload: {} });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'invalid_idempotency_key',
        message: 'Idempotency-Key header is missing or invalid',
      });
    });

    it('replies 400 when the key is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: { 'Idempotency-Key': 'a b' },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('invalid_idempotency_key');
    });
  });

  describe('sendContractError', () => {
    it('renders a conflict raised by route code as 409', async () => {
      const submit = (payload: object) =>
        app.inject({ method: 'POST', url: '/v1/jobs', headers: { 'Idempotency-Key': 'k' }, payload });
      await submit({ a: 1 });
      const response = await submit({ a: 2 });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('idempotency_key_conflict');
    });
  });

  describe('requireWebhookHeaders', () => {
    it('passes parsed headers to the route', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: buildWebhookHeaders({
          idempotencyKey: 'scrape-42',
          jobId: 'job-1',
          status: 'DONE',
          timestamp: 9,
        }),
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        idempotencyKey: 'scrape-42',
        jobId: 'job-1',
        webhookId: 'job-1:DONE',
        timestamp: 9,
      });
    });

    it('replies 400 when contract headers are missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: acceptedHeaders('job-1', '/x'),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('invalid_webhook_headers');
    });
  });
});

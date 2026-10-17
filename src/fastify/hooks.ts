import type { FastifyReply, FastifyRequest } from 'fastify';
import { ContractError, InvalidIdempotencyKeyError } from '../errors.js';
import { getHeader, IDEMPOTENCY_KEY_HEADER } from '../headers.js';
import { isValidIdempotencyKey } from '../idempotency.js';
import { parseWebhookHeaders, type WebhookHeaders } from '../webhook.js';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
    webhookHeaders?: WebhookHeaders;
  }
}

/**
 * Reply with a ContractError as `{error, message}`. Use it for an IdempotencyKeyConflictError thrown by
 * your own submit logic. These hooks reply directly instead of throwing, because Fastify allows only one
 * error handler and ts-auth-boilerplate's turns any error it doesn't know into a 500.
 */
export function sendContractError(reply: FastifyReply, err: ContractError): FastifyReply {
  return reply.code(err.statusCode).send({ error: err.code, message: err.message });
}

/**
 * Called-service preHandler for the submit route. Sets `request.idempotencyKey`, or replies 400 if the
 * header is missing or invalid.
 */
export async function requireIdempotencyKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  const key = getHeader(request.headers, IDEMPOTENCY_KEY_HEADER);
  if (!isValidIdempotencyKey(key)) return sendContractError(reply, new InvalidIdempotencyKeyError());
  request.idempotencyKey = key;
  return undefined;
}

/**
 * Calling-service preHandler for the webhook route. Sets `request.webhookHeaders`, or replies 400 if a
 * contract header is missing or malformed.
 */
export async function requireWebhookHeaders(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply | undefined> {
  try {
    request.webhookHeaders = parseWebhookHeaders(request.headers);
  } catch (err) {
    if (err instanceof ContractError) return sendContractError(reply, err);
    throw err;
  }
  return undefined;
}

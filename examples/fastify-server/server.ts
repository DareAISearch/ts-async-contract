// Both sides of the contract in one Fastify app, with in-memory storage.
//
// Run: npm run example
//
//   # called service: submit a job (repeat it to see a replay; change the body to see a 409)
//   curl -i -X POST localhost:3000/v1/jobs -H 'Idempotency-Key: demo-1' -H 'Content-Type: application/json' \
//        -d '{"url": "https://example.com"}'
//
//   # calling service: receive a webhook
//   curl -i -X POST localhost:3000/webhook -H 'Idempotency-Key: demo-1' -H 'Job-Id: j1' \
//        -H 'Webhook-Id: j1:COMPLETED' -H 'Webhook-Timestamp: 1760000000' -H 'Content-Type: application/json' -d '{}'

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { acceptedHeaders, bodyHash, IdempotencyKeyConflictError } from '../../src/index.js';
import { requireIdempotencyKey, requireWebhookHeaders, sendContractError } from '../../src/fastify/hooks.js';

const app = Fastify({ logger: true });

// Stand-ins for DB tables. A real service enforces (caller, key) uniqueness with a unique index.
const jobsByKey = new Map<string, { jobId: string; bodyHash: string; status: string }>();
const seenWebhookIds = new Set<string>();

app.post('/v1/jobs', { preHandler: requireIdempotencyKey }, async (request, reply) => {
  const key = request.idempotencyKey!;
  const hashed = bodyHash(request.body);
  let job = jobsByKey.get(key);
  if (!job) {
    job = { jobId: randomUUID(), bodyHash: hashed, status: 'PENDING' };
    jobsByKey.set(key, job); // ...and start the work exactly once, here
  } else if (job.bodyHash !== hashed) {
    return sendContractError(reply, new IdempotencyKeyConflictError());
  }

  return reply
    .code(202)
    .headers(acceptedHeaders(job.jobId, `/v1/jobs/${job.jobId}`))
    .send({ job_id: job.jobId, status: job.status });
});

app.post('/webhook', { preHandler: requireWebhookHeaders }, async (request) => {
  const hook = request.webhookHeaders!;
  if (seenWebhookIds.has(hook.webhookId)) return { duplicate: true }; // still 2xx, so the sender stops retrying
  seenWebhookIds.add(hook.webhookId);
  // route by hook.idempotencyKey (our own id), no lookup of the callee's id needed
  return { duplicate: false };
});

await app.listen({ port: 3000 });

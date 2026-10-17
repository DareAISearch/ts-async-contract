# ts-async-contract

The shared async job contract for DAIS services. One service (the **caller**) submits work to
another (the **callee**), gets a `202` back straight away, and later receives the outcome on a
webhook. This package holds the pieces both sides must agree on:

- **Idempotent submits** — the caller sends its own id as `Idempotency-Key`; the callee answers
  with its id in `Job-Id` and `Location`. A retried submit returns the original job instead of
  starting a second one.
- **Webhook delivery** — every delivery carries both ids plus `Webhook-Id` (for dropping
  duplicates) and `Webhook-Timestamp`, and one rule decides what gets retried.

Most services play both roles: web-scraping-service is a caller of llm-gateway and a callee for
its own clients. The Python twin is
[`py-async-contract`](https://github.com/DareAISearch/py-async-contract); both produce identical
headers and identical body hashes.

## What this is not

- **No storage.** The callee still needs a unique index on `(caller, idempotency_key)` and must
  treat a unique violation as a replay; the caller still needs to remember which `Webhook-Id`s it
  has processed. This package tells you what to store, not where.
- **No HTTP client or retry loop.** `classifyWebhookResponse` says whether to retry; your job
  runner (Temporal, etc.) does the retrying.
- **No webhook signing.** Authenticate deliveries with a bearer token (see
  [`ts-auth-boilerplate`](https://github.com/DareAISearch/ts-auth-boilerplate)).
  `Webhook-Timestamp` is informational until deliveries are signed: don't reject on it.

## Installing

Not on npm yet — install straight from this GitHub repo. Requires Node.js 24+.

```bash
npm install github:DareAISearch/ts-async-contract#v0.1.0
```

or in `package.json`:

```json
"dependencies": {
  "ts-async-contract": "github:DareAISearch/ts-async-contract#v0.1.0"
}
```

`fastify` is an optional peer dependency, only for the hooks in `ts-async-contract/fastify`. The
main entry point (`ts-async-contract`) never references it, not even in its types.

## The contract

Header names are hyphenated on purpose: nginx drops headers with underscores by default.

### Submit

|                | Header            | Value                                                                             |
| -------------- | ----------------- | --------------------------------------------------------------------------------- |
| Request        | `Idempotency-Key` | **Required.** The caller's own id for this job: 1-255 chars of `[A-Za-z0-9._:-]`. |
| `202` response | `Job-Id`          | The callee's id for the job.                                                      |
| `202` response | `Location`        | Where to poll it, e.g. `/v1/requests/<job-id>`.                                   |

Keys are scoped to the caller (its auth token's `sub`). The callee compares bodies by `bodyHash`
(below):

| Same key, and...       | Response                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| first time seen        | `202`, new job, work starts                                                  |
| same body              | `202` with the **existing** job (same `Job-Id`, current status); no new work |
| different body         | `409 {"error": "idempotency_key_conflict", "message": ...}`                  |
| key missing or invalid | `400 {"error": "invalid_idempotency_key", "message": ...}`                   |

### Webhook

| Header              | Value                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| `Idempotency-Key`   | The caller's key from the submit. Route on this; no lookup of the callee's id needed. |
| `Job-Id`            | The callee's id.                                                                      |
| `Webhook-Id`        | `<job-id>:<status>`. The same on every retry of one event; use it to drop duplicates. |
| `Webhook-Timestamp` | Unix seconds when this attempt was sent. New on every retry.                          |
| `Authorization`     | `Bearer <M2M token>`.                                                                 |

The ids travel **only** in these headers; don't repeat them in the body, so there's a single
source of truth. The body carries just the job's outcome. What the receiver's response means:

| Response                                  | Outcome                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `2xx`                                     | delivered                                             |
| `5xx`, `429`, timeout or connection error | retry with backoff                                    |
| anything else (`4xx`, `3xx`)              | permanent — the same payload will get the same answer |

So a receiver should answer a **duplicate** with `2xx`, not an error, and use `5xx` or `429`
(never `404`) when it wants the delivery tried again later.

## Usage

### As the callee (accepting jobs, sending webhooks)

```ts
import { acceptedHeaders, bodyHash, IdempotencyKeyConflictError } from 'ts-async-contract';
import { requireIdempotencyKey, sendContractError } from 'ts-async-contract/fastify';

app.post('/v1/requests', { preHandler: [requireAuth, requireIdempotencyKey] }, async (request, reply) => {
  const key = request.idempotencyKey!;
  const hashed = bodyHash(request.body);
  const job = await insertOrGet(callerSub, key, hashed); // unique index on (caller_sub, key)
  if (job.bodyHash !== hashed) return sendContractError(reply, new IdempotencyKeyConflictError()); // 409

  return reply.code(202).headers(acceptedHeaders(job.id, `/v1/requests/${job.id}`)).send({ ... });
});
```

The hooks reply directly instead of throwing: Fastify allows a single error handler, and
ts-auth-boilerplate's turns errors it doesn't know into a `500`.

Sending a webhook, once per attempt:

```ts
import { buildWebhookHeaders, classifyWebhookResponse } from 'ts-async-contract';

const headers = buildWebhookHeaders({
  idempotencyKey: job.idempotencyKey,
  jobId: job.id,
  status: job.status,
  bearerToken: token,
});
const response = await fetch(job.webhookUrl, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  redirect: 'manual', // a followed redirect turns the POST into a body-less GET
});
switch (classifyWebhookResponse(response.status)) {
  case 'delivered':
    return markDelivered(job);
  case 'retry':
    throw new Error(`webhook ${response.status}`); // retryable
  case 'permanent':
    throw ApplicationFailure.nonRetryable(`webhook ${response.status}`);
}
```

### As the caller (submitting jobs, receiving webhooks)

```ts
import { parseAcceptedHeaders, submitHeaders } from 'ts-async-contract';

const response = await fetch(`${gateway}/v1/requests`, {
  method: 'POST',
  headers: {
    ...submitHeaders(myJob.id), // reuse the same key on every retry of this submit
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});
const { jobId, location } = parseAcceptedHeaders(response.headers);
```

```ts
import { requireWebhookHeaders } from 'ts-async-contract/fastify';

app.post('/v1/webhook', { preHandler: [requireAuth, requireWebhookHeaders] }, async (request, reply) => {
  const hook = request.webhookHeaders!;
  if (await alreadyProcessed(hook.webhookId)) return reply.code(200).send({ received: true }); // stop retries
  const myJob = await findJob(hook.idempotencyKey); // our own id: no race with the 202
  // ...
});
```

A runnable app showing both roles is in `examples/fastify-server/server.ts` (`npm run example`).

## API

From `ts-async-contract`:

| Name                                                      | Side   | Purpose                                                                              |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `submitHeaders(key)`                                      | caller | `{'Idempotency-Key': key}`; `TypeError` if the key is invalid.                       |
| `parseAcceptedHeaders(headers)`                           | caller | `{jobId, location}` from a `202`; `InvalidAcceptedResponseError` without `Job-Id`.   |
| `parseWebhookHeaders(headers)`                            | caller | `{idempotencyKey, jobId, webhookId, timestamp}`; `InvalidWebhookHeadersError` (400). |
| `isValidIdempotencyKey(value)`                            | callee | Format check (a type guard).                                                         |
| `bodyHash(body)` / `canonicalJson(body)`                  | callee | sha256 of the RFC 8785 canonical JSON of a parsed body.                              |
| `acceptedHeaders(jobId, location)`                        | callee | `Job-Id` and `Location` for the `202`.                                               |
| `buildWebhookHeaders({...})` / `webhookId(jobId, status)` | callee | Headers for one delivery attempt.                                                    |
| `classifyWebhookResponse(statusCode)`                     | callee | `'delivered'`, `'retry'` or `'permanent'`.                                           |
| `IdempotencyKeyConflictError`                             | callee | `409`; throw or send it from your submit logic.                                      |
| `getHeader(headers, name)`                                | both   | Case-insensitive lookup over fetch `Headers` or a plain record.                      |

From `ts-async-contract/fastify`: `requireIdempotencyKey` (sets `request.idempotencyKey`),
`requireWebhookHeaders` (sets `request.webhookHeaders`), and `sendContractError(reply, err)`.

`ContractError` (`statusCode` + `code`) is the base of the `4xx` errors.

## Body hashing

`bodyHash` is the sha256 of the body serialized per [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
(JSON Canonicalization Scheme): keys sorted by UTF-16 code units, no whitespace, numbers in
ECMAScript form, non-ASCII emitted raw. So the same JSON document hashes the same in TypeScript and
Python, however it was formatted on the wire. `undefined` is handled as `JSON.stringify` handles it,
so the hash matches what is actually sent.

Hash the **parsed** body as received, not your validated model: defaults and normalization would
otherwise make a genuine replay look like a conflict. An explicit `null` and an omitted field are
different bodies.

`test/fixtures/body_hash_vectors.json` is shared byte-for-byte with py-async-contract, which
generates it, and is checked by both test suites. It's excluded from Prettier so it stays identical.

## Development

```bash
npm install

npm test
npm run typecheck
npm run typecheck:test
npm run format:check
```

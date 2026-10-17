/**
 * A request that breaks the async contract. Carries the HTTP status and `error` code to answer with;
 * `sendContractError` renders it as `{error, message}`.
 */
export class ContractError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'ContractError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class InvalidIdempotencyKeyError extends ContractError {
  constructor(message = 'Idempotency-Key header is missing or invalid') {
    super(400, message, 'invalid_idempotency_key');
  }
}

/** Thrown by the called service when a key is reused with a different request body. */
export class IdempotencyKeyConflictError extends ContractError {
  constructor(message = 'Idempotency-Key was already used with a different request body') {
    super(409, message, 'idempotency_key_conflict');
  }
}

export class InvalidWebhookHeadersError extends ContractError {
  constructor(message: string) {
    super(400, message, 'invalid_webhook_headers');
  }
}

// Deliberately not a ContractError: a 202 missing the contract headers is a fault in the upstream
// service, not something to answer our own client with a 4xx for.
export class InvalidAcceptedResponseError extends Error {}

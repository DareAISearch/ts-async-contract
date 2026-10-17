import { InvalidAcceptedResponseError } from './errors.js';
import {
  getHeader,
  IDEMPOTENCY_KEY_HEADER,
  JOB_ID_HEADER,
  LOCATION_HEADER,
  type HeaderSource,
} from './headers.js';
import { isValidIdempotencyKey } from './idempotency.js';

/** What the called service's 202 told us: its own id for the job, and where to poll it. */
export interface AcceptedJob {
  jobId: string;
  location: string | null;
}

// --- calling service ---

/**
 * Headers to add to a submit request. Reuse the same key when retrying the same submit.
 * Throws TypeError for an invalid key: that's a bug in the caller, not a client error to relay.
 */
export function submitHeaders(idempotencyKey: string): Record<string, string> {
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new TypeError(`invalid idempotency key: ${JSON.stringify(idempotencyKey)}`);
  }
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey };
}

/** Read Job-Id (required) and Location from the called service's 202 response headers. */
export function parseAcceptedHeaders(headers: HeaderSource): AcceptedJob {
  const jobId = getHeader(headers, JOB_ID_HEADER);
  if (!jobId) throw new InvalidAcceptedResponseError(`202 response has no ${JOB_ID_HEADER} header`);
  return { jobId, location: getHeader(headers, LOCATION_HEADER) || null };
}

// --- called service ---

/** Headers for the 202 answering a submit (first time or replay). */
export function acceptedHeaders(jobId: string, location: string): Record<string, string> {
  return { [JOB_ID_HEADER]: jobId, [LOCATION_HEADER]: location };
}

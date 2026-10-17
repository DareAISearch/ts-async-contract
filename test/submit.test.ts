import { describe, expect, it } from 'vitest';
import { InvalidAcceptedResponseError } from '../src/errors.js';
import { acceptedHeaders, parseAcceptedHeaders, submitHeaders } from '../src/submit.js';

describe('submitHeaders', () => {
  it('sets the Idempotency-Key header', () => {
    expect(submitHeaders('scrape-42')).toEqual({ 'Idempotency-Key': 'scrape-42' });
  });

  it('throws TypeError for an invalid key, since that is a caller bug', () => {
    expect(() => submitHeaders('not valid')).toThrow(TypeError);
  });
});

describe('acceptedHeaders', () => {
  it('sets Job-Id and Location', () => {
    expect(acceptedHeaders('job-1', '/v1/requests/job-1')).toEqual({
      'Job-Id': 'job-1',
      Location: '/v1/requests/job-1',
    });
  });

  it('round-trips through parseAcceptedHeaders', () => {
    expect(parseAcceptedHeaders(acceptedHeaders('job-1', '/v1/requests/job-1'))).toEqual({
      jobId: 'job-1',
      location: '/v1/requests/job-1',
    });
  });
});

describe('parseAcceptedHeaders', () => {
  it('reads a fetch Response.headers', () => {
    const response = new Response(null, {
      status: 202,
      headers: { 'Job-Id': 'job-1', Location: '/v1/requests/job-1' },
    });
    expect(parseAcceptedHeaders(response.headers)).toEqual({
      jobId: 'job-1',
      location: '/v1/requests/job-1',
    });
  });

  it('reads lowercased plain-record headers', () => {
    expect(parseAcceptedHeaders({ 'job-id': 'job-1', location: '/v1/requests/job-1' })).toEqual({
      jobId: 'job-1',
      location: '/v1/requests/job-1',
    });
  });

  it('treats Location as optional', () => {
    expect(parseAcceptedHeaders({ 'Job-Id': 'job-1' })).toEqual({ jobId: 'job-1', location: null });
  });

  it.each([{}, { 'Job-Id': '' }, { Location: '/v1/requests/job-1' }, { 'job-id': ['a', 'b'] }])(
    'throws InvalidAcceptedResponseError without a single Job-Id: %j',
    (headers) => {
      expect(() => parseAcceptedHeaders(headers)).toThrow(InvalidAcceptedResponseError);
    }
  );
});

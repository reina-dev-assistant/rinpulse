import { describe, expect, it } from 'bun:test';

import { RideJoinError, joinErrorKind } from './errors';

describe('joinErrorKind', () => {
  it('names the relay answers', () => {
    expect(joinErrorKind(401)).toBe('notSignedIn');
    expect(joinErrorKind(400)).toBe('notFound');
    expect(joinErrorKind(404)).toBe('notFound');
    expect(joinErrorKind(409)).toBe('taken');
    expect(joinErrorKind(429)).toBe('rateLimited');
    expect(joinErrorKind(500)).toBe('network');
    expect(joinErrorKind(503)).toBe('network');
  });

  it('RideJoinError carries its kind', () => {
    const error = new RideJoinError('taken', 'room_taken');
    expect(error.kind).toBe('taken');
    expect(error.message).toBe('room_taken');
    expect(new RideJoinError('notFound').message).toBe('notFound');
  });
});

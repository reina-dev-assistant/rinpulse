import { describe, expect, it } from 'bun:test';

import { activityRange, isMcpTool, mcpScopeKey, readableScopeKeys } from './scopes';

describe('readableScopeKeys', () => {
  it('lists the known scopes in the consent order with their catalog keys', () => {
    expect(readableScopeKeys(['recovery:read', 'food:read', 'profile:read'])).toEqual(['profile_read', 'food_read', 'recovery_read']);
  });

  it('leaves out scopes it cannot word', () => {
    expect(readableScopeKeys(['offline_access', 'food:write', 'weight:read'])).toEqual(['weight_read']);
    expect(readableScopeKeys([])).toEqual([]);
  });

  it('maps every scope to the key of JoyoRogo\'s catalog', () => {
    expect(mcpScopeKey('workouts:read')).toBe('workouts_read');
  });
});

describe('activityRange', () => {
  it('reads the days of a ranged tool', () => {
    expect(activityRange('{"from":"2026-10-01","to":"2026-10-07"}')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(activityRange('{"from":"2026-10-01","to":"2026-10-07","limit":20}')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  });

  it('is null without a usable range', () => {
    expect(activityRange(null)).toBeNull();
    expect(activityRange('{"id":"abc"}')).toBeNull();
    expect(activityRange('{"from":"yesterday","to":"today"}')).toBeNull();
    expect(activityRange('not json')).toBeNull();
    expect(activityRange('"2026-10-01"')).toBeNull();
    expect(activityRange('{"from":"2026-10-01","to":"2026-10-07"')).toBeNull();
  });
});

describe('isMcpTool', () => {
  it('knows the connector tools only', () => {
    expect(isMcpTool('get_food_log')).toBe(true);
    expect(isMcpTool('delete_everything')).toBe(false);
  });
});

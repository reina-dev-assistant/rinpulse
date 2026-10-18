/** The data scopes of JoyoRogo's AI connector, in the order the consent screen lists them (`MCP_DATA_SCOPES` in the joyorogo repo). */
export const MCP_DATA_SCOPES = ['profile:read', 'food:read', 'weight:read', 'workouts:read', 'recovery:read'] as const;
export type McpDataScope = (typeof MCP_DATA_SCOPES)[number];

/** Key of a scope in the `koneksi` catalog: `scope.<key>.label` and `scope.<key>.desc` (the scope with `:` as `_`). */
export type McpScopeKey = 'profile_read' | 'food_read' | 'weight_read' | 'workouts_read' | 'recovery_read';

export function mcpScopeKey(scope: McpDataScope): McpScopeKey {
  return scope.replace(':', '_') as McpScopeKey;
}

/** The scopes an app holds that the screen can word, in the consent screen's order; anything else the server may add later is left out. */
export function readableScopeKeys(scopes: readonly string[]): McpScopeKey[] {
  return MCP_DATA_SCOPES.filter((scope) => scopes.includes(scope)).map(mcpScopeKey);
}

/** The tools of JoyoRogo's connector, as the `activity.tool.<name>` keys of the `koneksi` catalog. */
export const MCP_TOOLS = [
  'get_profile',
  'get_food_log',
  'get_daily_totals',
  'get_weight_history',
  'list_workouts',
  'get_workout',
  'get_recovery_metrics',
] as const;
export type McpTool = (typeof MCP_TOOLS)[number];

export function isMcpTool(tool: string): tool is McpTool {
  return (MCP_TOOLS as readonly string[]).includes(tool);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The `from` and `to` days of an activity row's `args` (JSON text), when it has both; null for a tool without a range. */
export function activityRange(args: string | null): { from: string; to: string } | null {
  if (!args) return null;
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { from, to } = parsed as { from?: unknown; to?: unknown };
    return typeof from === 'string' && typeof to === 'string' && DAY.test(from) && DAY.test(to) ? { from, to } : null;
  } catch {
    return null;
  }
}

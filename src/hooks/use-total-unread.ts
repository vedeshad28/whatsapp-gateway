'use client';

/**
 * Total unread conversation count for the inbox nav badge. Stubbed at
 * 0 until Phase 7 (notifications/presence) wires it up against real
 * conversation data — see the restoration plan. Kept as a hook (not
 * inlined) so the Sidebar's call site doesn't change when this fills in.
 */
export function useTotalUnread(): number {
  return 0;
}

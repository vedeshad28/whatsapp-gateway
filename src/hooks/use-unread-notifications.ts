'use client';

/**
 * Unread notification count for the sidebar nav badge. Stubbed at 0
 * until Phase 7 restores the `Notification` model and its API — see
 * the restoration plan. Kept as a hook so the Sidebar's call site
 * doesn't change when this fills in.
 */
export function useUnreadNotifications(): number {
  return 0;
}

// ============================================================
// Workspace role helpers — pure, unit-testable, no I/O.
//
// Mirrors the `WorkspaceRole` Prisma enum (prisma/schema.prisma).
// The hierarchy is a flat ordinal (owner=4 … viewer=1), same shape
// wacrm's `account_role_enum` used — ported onto Prisma/plain
// Postgres rather than Postgres RLS, so these predicates are now the
// ONLY enforcement (see requireWorkspaceMembership in
// src/lib/auth/session-context.ts — there's no RLS safety net here).
//
// Predicates (`canManageMembers`, `canEditSettings`, …) are the
// single source of truth for "what can this role do?" — both API
// route guards and UI gates should call them rather than open-coding
// role checks.
// ============================================================

export type WorkspaceRole = 'owner' | 'admin' | 'agent' | 'viewer';

/** Ordered list of every valid role, lowest privilege first. */
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'viewer',
  'agent',
  'admin',
  'owner',
] as const;

export function roleRank(role: WorkspaceRole): number {
  switch (role) {
    case 'owner':
      return 4;
    case 'admin':
      return 3;
    case 'agent':
      return 2;
    case 'viewer':
      return 1;
  }
}

/** True iff `role` is at least as privileged as `min`. */
export function hasMinRole(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return roleRank(role) >= roleRank(min);
}

/** Type-narrow an unknown string into a valid `WorkspaceRole`. */
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === 'string' &&
    (WORKSPACE_ROLES as readonly string[]).includes(value)
  );
}

// ----------------------------------------------------------
// Capability predicates — one new predicate here + one call-site
// change per consumer whenever a capability changes.
// ----------------------------------------------------------

/** Owner / admin: invite, remove, change member roles. */
export function canManageMembers(role: WorkspaceRole): boolean {
  return hasMinRole(role, 'admin');
}

/** Owner / admin: edit workspace-wide settings, manage API keys. */
export function canEditSettings(role: WorkspaceRole): boolean {
  return hasMinRole(role, 'admin');
}

/** Owner / admin / agent: write operational data. Viewers are read-only. */
export function canSendMessages(role: WorkspaceRole): boolean {
  return hasMinRole(role, 'agent');
}

/** Viewer: read-only across everything. */
export function canViewOnly(role: WorkspaceRole): boolean {
  return role === 'viewer';
}

/** Owner only: hand the workspace to another member. */
export function canTransferOwnership(role: WorkspaceRole): boolean {
  return role === 'owner';
}

// ============================================================
// Dashboard session authentication — resolves a request's session
// cookie into the signed-in user + their workspace memberships.
//
// Mirrors src/lib/auth/api-context.ts (requireApiKey / requireAccountAccess)
// but for human, cookie-based sessions instead of API keys:
//
//   try {
//     const ctx = await requireSession();
//     const membership = requireWorkspaceMembership(ctx, workspaceId);
//     const account = await requireWorkspaceAccountAccess(membership, accountId);
//   } catch (err) {
//     return toSessionErrorResponse(err);
//   }
//
// A signed-up user's Workspace has a 1:1 `clientId` — the SAME kind
// of Client row salon-saas authenticates as via API key. Dashboard
// routes scope every query by `membership.clientId`, exactly like
// `requireAccountAccess` scopes by `ctx.clientId` for API callers.
// This is the deliberate convergence point: one Account/tenancy model,
// two auth transports.
//
// Like the API-key auth path, this is applied per-route, not globally
// via src/proxy.ts — see that file's header comment for why.
// ============================================================

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import type { WorkspaceRole } from '@/lib/auth/roles';

export class SessionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SessionError';
    this.status = status;
  }
}

export interface WorkspaceMembership {
  workspaceId: string;
  clientId: string;
  /** Set for a salon-saas-tenant Workspace — see Workspace.linkedAccountId. */
  linkedAccountId: string | null;
  role: WorkspaceRole;
}

export interface SessionContext {
  userId: string;
  email: string;
  name: string | null;
  memberships: WorkspaceMembership[];
}

/** 401 if there's no valid session cookie. */
export async function requireSession(): Promise<SessionContext> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionUser(token);
  if (!session) throw new SessionError('Not signed in', 401);

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    memberships: session.user.memberships.map((m) => ({
      workspaceId: m.workspaceId,
      clientId: m.workspace.clientId,
      linkedAccountId: m.workspace.linkedAccountId,
      role: m.role,
    })),
  };
}

/**
 * Verify the session user belongs to `workspaceId` and return that
 * membership. Throws 404 (not 403) on a mismatch, same rationale as
 * `requireAccountAccess`: don't let the response confirm which
 * workspace ids exist.
 */
export function requireWorkspaceMembership(
  ctx: SessionContext,
  workspaceId: string
): WorkspaceMembership {
  const membership = ctx.memberships.find((m) => m.workspaceId === workspaceId);
  if (!membership) throw new SessionError('Workspace not found', 404);
  return membership;
}

/**
 * Verify `accountId` belongs to the same Client as `membership` and
 * return it. The dashboard-side twin of `requireAccountAccess` in
 * api-context.ts — same query, same 404-not-403 rationale, different
 * caller (a workspace membership instead of an API key context).
 */
export async function requireWorkspaceAccountAccess(
  membership: WorkspaceMembership,
  accountId: string
) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || account.clientId !== membership.clientId) {
    throw new SessionError('Account not found', 404);
  }
  return account;
}

/** Map a thrown `SessionError` (or anything else) to the dashboard's internal `{ error }` envelope — see respond.ts's header comment for why this differs from the public `/api/v1` envelope. */
export function toSessionErrorResponse(err: unknown): NextResponse {
  if (err instanceof SessionError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[auth/session-context] uncategorized error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

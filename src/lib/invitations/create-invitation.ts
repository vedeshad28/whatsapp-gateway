// ============================================================
// Shared invitation-creation logic — pulled out of
// POST /api/account/invitations so the API-key-gated
// POST /api/v1/accounts/{id}/invite route (salon-saas provisioning a
// tenant's dashboard login) can create the same kind of
// WorkspaceInvitation row without duplicating the token/hash logic.
//
// No email transport wired up yet (matches the existing invitations
// route's behavior) — callers get the plaintext redeem path back and
// are responsible for delivering it.
// ============================================================

import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { WorkspaceRole } from '@/lib/auth/roles';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export interface CreateInvitationArgs {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  /** Null for an API-key-triggered invite — there's no signed-in user to attribute it to. */
  invitedById: string | null;
}

export async function createWorkspaceInvitation(args: CreateInvitationArgs) {
  const email = args.email.trim().toLowerCase();
  const plaintext = randomBytes(32).toString('base64url');
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      workspaceId: args.workspaceId,
      email,
      role: args.role,
      tokenHash: hashToken(plaintext),
      invitedById: args.invitedById,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
  return { invitation, redeemPath: `/join/${plaintext}` };
}

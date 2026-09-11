// ============================================================
// Resolve a workspace's own WhatsApp `Account` — every CRM route
// scoped by "the workspace's contacts/conversations/messages" (not
// team/API-key management, which is scoped by clientId alone) needs
// this. See src/app/api/account/whatsapp/route.ts for where the
// sentinel externalRef "workspace" is created.
// ============================================================

import { prisma } from '@/lib/db';
import type { WorkspaceMembership } from '@/lib/auth/session-context';

const WORKSPACE_ACCOUNT_EXTERNAL_REF = 'workspace';

/** Returns the workspace's Account id, or null if no WhatsApp number has been connected yet. */
export async function resolveWorkspaceAccountId(
  membership: Pick<WorkspaceMembership, 'clientId' | 'linkedAccountId'>
): Promise<string | null> {
  // A salon-saas-tenant Workspace points straight at its one Account —
  // it never has a 'workspace'-sentinel Account of its own (that
  // Account belongs to salon-saas's shared Client, not this Workspace's
  // shell Client). See Workspace.linkedAccountId in schema.prisma.
  if (membership.linkedAccountId) return membership.linkedAccountId;

  const account = await prisma.account.findUnique({
    where: {
      clientId_externalRef: { clientId: membership.clientId, externalRef: WORKSPACE_ACCOUNT_EXTERNAL_REF },
    },
    select: { id: true },
  });
  return account?.id ?? null;
}

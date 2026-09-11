// ============================================================
// POST /api/v1/accounts/{id}/invite — provision (or extend) a
// dashboard login for one gateway Account.
//
// Lets a calling app (salon-saas) turn on CRM-dashboard access for
// one of its tenants without a human ever touching the gateway's own
// signup flow. The first invite on an Account creates a lightweight
// Workspace linked directly to that Account (see
// Workspace.linkedAccountId in schema.prisma) and invites the given
// email as its owner; later calls for the same Account just invite
// more people into that same Workspace as admins.
//
// Auth: API key with the `accounts:manage` scope (same scope
// POST /api/v1/accounts already requires — this is account lifecycle
// management, not a new capability).
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { createWorkspaceInvitation } from '@/lib/invitations/create-invitation';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const { id: accountId } = await params;
    const account = await requireAccountAccess(ctx, accountId);

    const body = (await request.json().catch(() => null)) as
      | { email?: unknown; name?: unknown }
      | null;
    if (typeof body?.email !== 'string' || !body.email.includes('@')) {
      throw badRequest("A valid 'email' is required");
    }
    const displayName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;

    let workspace = await prisma.workspace.findUnique({ where: { linkedAccountId: accountId } });
    let role: 'owner' | 'admin' = 'admin';

    if (!workspace) {
      const workspaceName = displayName ?? account.label ?? 'WhatsApp CRM';
      workspace = await prisma.$transaction(async (tx) => {
        const client = await tx.client.create({ data: { name: workspaceName } });
        return tx.workspace.create({
          data: { clientId: client.id, name: workspaceName, linkedAccountId: accountId },
        });
      });
      role = 'owner';
    }

    const { redeemPath } = await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email: body.email,
      role,
      invitedById: null,
    });

    const publicBaseUrl = process.env.GATEWAY_PUBLIC_BASE_URL;
    const inviteUrl = publicBaseUrl ? `${publicBaseUrl}${redeemPath}` : redeemPath;

    return ok({ invite_url: inviteUrl }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

// ============================================================
// GET    /api/account/whatsapp?workspace_id=<id>  — connection status
// POST   /api/account/whatsapp                     — connect (manual: paste phone_number_id/waba_id/access_token)
// DELETE /api/account/whatsapp                     — disconnect
//
// Session-gated (admin+) twin of /api/whatsapp/config — same
// connect/status/disconnect logic (src/lib/whatsapp/connect-account.ts),
// scoped by workspace membership instead of an API key. Lazily
// provisions the workspace's own `Account` row (externalRef
// "workspace" — the sentinel for a workspace's single self-managed
// WhatsApp connection, distinct from any externalRef a Client like
// salon-saas assigns) on first connect attempt, since a fresh
// workspace has no Account until someone actually connects a number.
//
// Embedded Signup requires the Meta app to be in Live mode with
// review approval (see the "Meta Embedded Signup" gotcha from prior
// sessions) — until then this only supports the manual path
// (`access_token` pasted directly, no `code`).
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';
import { canEditSettings } from '@/lib/auth/roles';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';
import {
  getConnectionStatus,
  connectAccount,
  disconnectAccount,
  ConnectAccountError,
} from '@/lib/whatsapp/connect-account';

/** Sentinel externalRef for a workspace's own self-managed WhatsApp Account. */
const WORKSPACE_ACCOUNT_EXTERNAL_REF = 'workspace';

// `sendMessageToConversation` (src/lib/whatsapp/send-message.ts, shared
// with the gateway's own /api/whatsapp/send) rejects a send when
// `AccountWallet.balance <= 0` — that credit-metering exists for
// salon-saas's pay-per-message tenants, not for a self-hosted CRM
// workspace. Rather than special-case workspace accounts inside the
// shared send path (which salon-saas's tests pin the exact behavior
// of), a workspace's own Account gets a wallet seeded with a large
// balance once, here, so it reads as "unmetered" without touching
// send-message.ts at all.
const UNMETERED_WALLET_BALANCE = 1_000_000;

async function getOrCreateWorkspaceAccount(clientId: string, label: string) {
  const existing = await prisma.account.findUnique({
    where: { clientId_externalRef: { clientId, externalRef: WORKSPACE_ACCOUNT_EXTERNAL_REF } },
  });
  if (existing) return existing;

  return prisma.account.create({
    data: {
      clientId,
      externalRef: WORKSPACE_ACCOUNT_EXTERNAL_REF,
      label,
      wallet: { create: { balance: UNMETERED_WALLET_BALANCE } },
    },
  });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);

    // Use the shared resolver (not a raw clientId_externalRef lookup) so a
    // salon-saas-tenant workspace's linkedAccountId is honored — that
    // Account lives under a different Client entirely, so the old inline
    // lookup here always missed it and falsely reported "not connected".
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ data: { connected: false, reason: 'no_account' } });
    }

    return NextResponse.json({ data: { account_id: accountId, ...(await getConnectionStatus(accountId)) } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canEditSettings(membership.role)) {
      throw new SessionError('Only owners and admins can connect a WhatsApp number', 403);
    }
    if (membership.linkedAccountId) {
      throw new SessionError(
        'This workspace is linked to an externally-managed WhatsApp number — connect or change it from wherever it was originally set up, not here.',
        400
      );
    }

    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: body.workspace_id } });
    const account = await getOrCreateWorkspaceAccount(membership.clientId, workspace.name);

    try {
      const result = await connectAccount(account.id, {
        phoneNumberId: typeof body.phone_number_id === 'string' ? body.phone_number_id : '',
        wabaId: typeof body.waba_id === 'string' ? body.waba_id : null,
        accessToken: typeof body.access_token === 'string' ? body.access_token : '',
        pin: typeof body.pin === 'string' ? body.pin : undefined,
        coexistence: body.coexistence === true,
      });
      return NextResponse.json({ data: { account_id: account.id, ...result } });
    } catch (err) {
      if (err instanceof ConnectAccountError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as { workspace_id?: unknown } | null;
    if (!body || typeof body.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canEditSettings(membership.role)) {
      throw new SessionError('Only owners and admins can disconnect a WhatsApp number', 403);
    }
    if (membership.linkedAccountId) {
      throw new SessionError(
        'This workspace is linked to an externally-managed WhatsApp number — disconnect it from wherever it was originally set up, not here.',
        400
      );
    }

    const account = await prisma.account.findUnique({
      where: {
        clientId_externalRef: { clientId: membership.clientId, externalRef: WORKSPACE_ACCOUNT_EXTERNAL_REF },
      },
    });
    if (account) {
      await disconnectAccount(account.id);
    }

    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

// ============================================================
// GET  /api/account/api-keys?workspace_id=<id>  — list keys (masked). Admin+.
// POST /api/account/api-keys { workspace_id, name, scopes }  — Admin+.
//
// These create/list the SAME `ApiKey` rows (keyed by `clientId`) that
// the gateway's own API-key auth path already reads via
// findActiveKeyByHash (src/lib/api-keys/store.ts) — a workspace's
// `clientId` is exactly the Client an API key belongs to. Nothing
// about the gateway's requireApiKey auth changes: this route just
// gives a signed-in dashboard user (admin+) a UI to manage the keys
// they'd otherwise have to create via direct SQL.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';
import { canManageMembers } from '@/lib/auth/roles';
import { generateApiKey } from '@/lib/api-keys/keys';
import { normalizeScopes } from '@/lib/api-keys/scopes';

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can view API keys', 403);
    }

    const rows = await prisma.apiKey.findMany({
      where: { clientId: membership.clientId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        key_prefix: row.keyPrefix,
        scopes: row.scopes,
        last_used_at: row.lastUsedAt,
        expires_at: row.expiresAt,
        revoked_at: row.revokedAt,
        created_at: row.createdAt,
      })),
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; name?: unknown; scopes?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json(
        { error: "'workspace_id' and a non-empty 'name' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can create API keys', 403);
    }

    const scopes = normalizeScopes(body.scopes ?? []);
    if (scopes === null) {
      return NextResponse.json({ error: "'scopes' contains an unknown scope" }, { status: 400 });
    }

    const generated = generateApiKey();
    const row = await prisma.apiKey.create({
      data: {
        clientId: membership.clientId,
        name: body.name.trim(),
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        scopes,
      },
    });

    return NextResponse.json(
      {
        data: {
          id: row.id,
          name: row.name,
          scopes: row.scopes,
          /** Plaintext — shown once, never persisted or retrievable again. */
          key: generated.plaintext,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

/** DELETE { workspace_id, key_id } — admin+ revokes a key (soft: sets revoked_at). */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; key_id?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.key_id !== 'string') {
      return NextResponse.json(
        { error: "'workspace_id' and 'key_id' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can revoke API keys', 403);
    }

    const key = await prisma.apiKey.findUnique({ where: { id: body.key_id } });
    if (!key || key.clientId !== membership.clientId) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

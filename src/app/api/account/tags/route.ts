// ============================================================
// GET  /api/account/tags?workspace_id=<id>              — list, alphabetical
// POST /api/account/tags { workspace_id, name, color? } — create
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
} from '@/lib/auth/session-context';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ data: [] });
    }

    const tags = await prisma.tag.findMany({
      where: { accountId },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      data: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; name?: unknown; color?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json(
        { error: "'workspace_id' and a non-empty 'name' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ error: 'Connect a WhatsApp number first (Settings → WhatsApp)' }, { status: 400 });
    }

    const name = body.name.trim();
    const existing = await prisma.tag.findUnique({ where: { accountId_name: { accountId, name } } });
    if (existing) {
      return NextResponse.json({ data: { id: existing.id, name: existing.name, color: existing.color } }, { status: 200 });
    }

    const tag = await prisma.tag.create({
      data: {
        accountId,
        name,
        color: typeof body.color === 'string' && body.color ? body.color : null,
      },
    });

    return NextResponse.json({ data: { id: tag.id, name: tag.name, color: tag.color } }, { status: 201 });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

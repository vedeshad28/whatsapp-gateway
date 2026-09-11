// ============================================================
// GET  /api/account/contacts?workspace_id=<id>            — list, newest first
// POST /api/account/contacts { workspace_id, phone, name } — create
//
// Session-gated, scoped to the workspace's own Account (see
// src/lib/auth/workspace-account.ts) — the SAME `Contact` rows the
// gateway's /api/v1/messages auto-creates when salon-saas (or, here,
// a dashboard user) sends to a new phone number. One shared table,
// two front doors.
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
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    const tagId = url.searchParams.get('tag_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ data: [] });
    }

    const contacts = await prisma.contact.findMany({
      where: { accountId, ...(tagId ? { tags: { some: { tagId } } } : {}) },
      include: { tags: { include: { tag: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        created_at: c.createdAt,
        tags: c.tags.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, color: ct.tag.color })),
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
      | { workspace_id?: unknown; phone?: unknown; name?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.phone !== 'string' || !body.phone.trim()) {
      return NextResponse.json(
        { error: "'workspace_id' and a non-empty 'phone' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Connect a WhatsApp number first (Settings → WhatsApp)' },
        { status: 400 }
      );
    }

    const phone = body.phone.trim();
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;

    const contact = await prisma.contact.upsert({
      where: { accountId_phone: { accountId, phone } },
      create: { accountId, phone, name },
      update: name ? { name } : {},
    });

    return NextResponse.json(
      { data: { id: contact.id, name: contact.name, phone: contact.phone } },
      { status: 201 }
    );
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

// ============================================================
// POST   /api/account/contacts/[id]/tags { workspace_id, tag_id } — apply a tag
// DELETE /api/account/contacts/[id]/tags?workspace_id=<id>&tag_id=<id> — remove
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
} from '@/lib/auth/session-context';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';

async function resolveContactAndTag(
  accountId: string | null,
  contactId: string,
  tagId: string
) {
  const [contact, tag] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId } }),
    prisma.tag.findUnique({ where: { id: tagId } }),
  ]);
  if (!contact || contact.accountId !== accountId) return { error: 'Contact not found' as const };
  if (!tag || tag.accountId !== accountId) return { error: 'Tag not found' as const };
  return { contact, tag };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; tag_id?: unknown }
      | null;
    if (typeof body?.workspace_id !== 'string' || typeof body.tag_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' and 'tag_id' are required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;

    const resolved = await resolveContactAndTag(accountId, id, body.tag_id);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId: id, tagId: body.tag_id } },
      create: { contactId: id, tagId: body.tag_id },
      update: {},
    });

    return NextResponse.json({ data: { success: true } }, { status: 201 });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    const tagId = url.searchParams.get('tag_id');
    if (!workspaceId || !tagId) {
      return NextResponse.json({ error: "'workspace_id' and 'tag_id' query params are required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;

    const resolved = await resolveContactAndTag(accountId, id, tagId);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    await prisma.contactTag.deleteMany({ where: { contactId: id, tagId } });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

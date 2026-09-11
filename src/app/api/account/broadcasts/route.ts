// ============================================================
// GET  /api/account/broadcasts?workspace_id=<id>  — list, newest first, with progress counts
// POST /api/account/broadcasts { workspace_id, name, template_id, audience_tag_id?, body_params?,
//                                 use_contact_name_var?, header_media_url?, header_filename?, header_text? }
//
// POST resolves the audience, pre-flight-checks wallet credits cover
// every recipient (the shared sendMessageToConversation only checks
// balance > 0, not enough for N sends — that check stays untouched;
// this is an additional guard at the broadcast layer), creates the
// Broadcast + one BroadcastRecipient per contact, then kicks off
// dispatchBroadcast() without awaiting it so the response returns
// immediately.
// ============================================================

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';
import { canSendMessages } from '@/lib/auth/roles';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { dispatchBroadcast } from '@/lib/whatsapp/broadcast-send';

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

    const broadcasts = await prisma.broadcast.findMany({
      where: { accountId },
      include: { template: true, audienceTag: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: broadcasts.map((b) => ({
        id: b.id,
        name: b.name,
        template_name: b.template.name,
        audience_tag: b.audienceTag ? b.audienceTag.name : null,
        status: b.status,
        total_recipients: b.totalRecipients,
        sent_count: b.sentCount,
        failed_count: b.failedCount,
        created_at: b.createdAt,
        completed_at: b.completedAt,
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
      | {
          workspace_id?: unknown;
          name?: unknown;
          template_id?: unknown;
          audience_tag_id?: unknown;
          body_params?: unknown;
          use_contact_name_var?: unknown;
          header_media_url?: unknown;
          header_filename?: unknown;
          header_text?: unknown;
        }
      | null;

    if (
      typeof body?.workspace_id !== 'string' ||
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      typeof body.template_id !== 'string'
    ) {
      return NextResponse.json(
        { error: "'workspace_id', a non-empty 'name', and 'template_id' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canSendMessages(membership.role)) {
      throw new SessionError('Viewers cannot send broadcasts', 403);
    }

    const limit = checkRateLimit(`broadcast:${ctx.userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) {
      return NextResponse.json({ error: 'Too many broadcasts launched recently — try again shortly' }, { status: 429 });
    }

    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ error: 'Connect a WhatsApp number first (Settings → WhatsApp)' }, { status: 400 });
    }

    const template = await prisma.messageTemplate.findUnique({ where: { id: body.template_id } });
    if (!template || template.accountId !== accountId || template.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Template not found or not approved' }, { status: 404 });
    }

    const audienceTagId = typeof body.audience_tag_id === 'string' ? body.audience_tag_id : null;
    if (audienceTagId) {
      const tag = await prisma.tag.findUnique({ where: { id: audienceTagId } });
      if (!tag || tag.accountId !== accountId) {
        return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
      }
    }

    const contacts = await prisma.contact.findMany({
      where: { accountId, ...(audienceTagId ? { tags: { some: { tagId: audienceTagId } } } : {}) },
      select: { id: true },
    });
    if (contacts.length === 0) {
      return NextResponse.json({ error: 'No contacts match this audience' }, { status: 400 });
    }

    const wallet = await prisma.accountWallet.findUnique({ where: { accountId } });
    if (!wallet || wallet.balance < contacts.length) {
      return NextResponse.json(
        {
          error: `Insufficient WhatsApp credits for ${contacts.length} recipients (balance: ${wallet?.balance ?? 0}).`,
        },
        { status: 402 }
      );
    }

    const bodyParams =
      body.body_params && typeof body.body_params === 'object' && !Array.isArray(body.body_params)
        ? (body.body_params as Record<string, unknown>)
        : null;
    const normalizedBodyParams = bodyParams
      ? Object.fromEntries(
          Object.entries(bodyParams).filter(([, v]) => typeof v === 'string')
        )
      : null;

    const useContactNameVar =
      typeof body.use_contact_name_var === 'number' && Number.isInteger(body.use_contact_name_var)
        ? body.use_contact_name_var
        : null;

    const broadcast = await prisma.broadcast.create({
      data: {
        accountId,
        name: body.name.trim(),
        templateId: template.id,
        audienceTagId,
        bodyParams: normalizedBodyParams ? (normalizedBodyParams as Prisma.InputJsonValue) : undefined,
        useContactNameVar,
        headerMediaUrl: typeof body.header_media_url === 'string' && body.header_media_url ? body.header_media_url : null,
        headerFilename: typeof body.header_filename === 'string' && body.header_filename ? body.header_filename : null,
        headerText: typeof body.header_text === 'string' && body.header_text ? body.header_text : null,
        totalRecipients: contacts.length,
        createdByUserId: ctx.userId,
        recipients: { create: contacts.map((c) => ({ contactId: c.id })) },
      },
    });

    // Fire-and-forget — see src/lib/whatsapp/broadcast-send.ts header
    // comment for why this is safe on this project's deployment model.
    void dispatchBroadcast(broadcast.id).catch((err) => {
      console.error(`[broadcasts] dispatch failed for ${broadcast.id}:`, err);
    });

    return NextResponse.json(
      { data: { id: broadcast.id, total_recipients: broadcast.totalRecipients } },
      { status: 201 }
    );
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

// ============================================================
// GET /api/account/media/{mediaId}?workspace_id=<id>
//
// Session-gated counterpart to /api/whatsapp/media/{mediaId} (which is
// API-key gated, for salon-saas-style consumers). Same proxy logic —
// Meta's media URLs are short-lived and need the account's Bearer
// token — just resolved via workspace membership instead of an API
// key, so the Inbox UI's <img>/<video>/<audio> tags can load it
// straight from the browser session.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
} from '@/lib/auth/session-context';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ error: 'No WhatsApp account connected' }, { status: 404 });
    }
    const { mediaId } = await params;
    if (!mediaId) {
      return NextResponse.json({ error: 'Media ID is required' }, { status: 400 });
    }

    const config = await prisma.whatsappConfig.findUnique({ where: { accountId } });
    if (!config) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 });
    }

    const accessToken = decrypt(config.accessToken);
    const mediaInfo = await getMediaUrl({ mediaId, accessToken });
    const { buffer, contentType } = await downloadMedia({ downloadUrl: mediaInfo.url, accessToken });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

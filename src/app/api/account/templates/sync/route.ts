// ============================================================
// POST /api/account/templates/sync { workspace_id }
//
// Pulls every template from Meta into the local table — session-
// gated (admin+) twin of POST /api/whatsapp/templates/sync, reusing
// the exact same logic (src/lib/whatsapp/template-manage.ts).
// ============================================================

import { NextResponse } from 'next/server';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';
import { canEditSettings } from '@/lib/auth/roles';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';
import { syncTemplates, TemplateManageError } from '@/lib/whatsapp/template-manage';

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as { workspace_id?: unknown } | null;
    if (!body || typeof body.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canEditSettings(membership.role)) {
      throw new SessionError('Only owners and admins can sync templates', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ error: 'Connect a WhatsApp number first (Settings → WhatsApp)' }, { status: 400 });
    }

    try {
      const result = await syncTemplates(accountId);
      return NextResponse.json({ data: result });
    } catch (e) {
      if (e instanceof TemplateManageError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

// ============================================================
// PATCH  /api/account/templates/[id] { workspace_id, ...TemplatePayload } — edit + resubmit
// DELETE /api/account/templates/[id]?workspace_id=<id>
//
// Session-gated (admin+) twins of the API-key-gated
// /api/whatsapp/templates/[id] route, reusing the exact same logic
// (src/lib/whatsapp/template-manage.ts).
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
import { editTemplate, deleteTemplate, TemplateManageError } from '@/lib/whatsapp/template-manage';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | (TemplatePayload & { workspace_id?: unknown })
      | null;
    if (!body || typeof body.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canEditSettings(membership.role)) {
      throw new SessionError('Only owners and admins can edit templates', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;

    try {
      const result = await editTemplate(accountId ?? '', id, body);
      return NextResponse.json({ data: { template: result.template, dry_run: result.dry_run } });
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    if (!canEditSettings(membership.role)) {
      throw new SessionError('Only owners and admins can delete templates', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;

    try {
      await deleteTemplate(accountId ?? '', id);
      return NextResponse.json({ data: { success: true } });
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

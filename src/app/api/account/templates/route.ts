// ============================================================
// GET  /api/account/templates?workspace_id=<id>&status=<APPROVED|all|...>
// POST /api/account/templates { workspace_id, ...TemplatePayload }  — submit
//
// GET defaults to `status=APPROVED` (unchanged from before — the
// broadcast composer's existing call keeps working as-is) or pass
// `status=all` for the full lifecycle view the Templates management
// page needs. `status` is never set by hand, it only ever arrives via
// Meta template sync, submit, or the status-update webhook (see
// src/app/api/whatsapp/templates/{sync,submit}/route.ts and
// src/lib/whatsapp/template-webhook.ts) — reading it here is always
// safe.
//
// POST reuses the exact same submit logic
// (src/lib/whatsapp/template-manage.ts) the API-key-gated
// /api/whatsapp/templates/submit route calls — admin+ only, since
// submitting a template is a workspace-wide, Meta-visible action.
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
import { extractVariableIndices, type TemplatePayload } from '@/lib/whatsapp/template-validators';
import { submitTemplate, TemplateManageError } from '@/lib/whatsapp/template-manage';

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    const statusParam = url.searchParams.get('status') ?? 'APPROVED';
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ data: [] });
    }

    const templates = await prisma.messageTemplate.findMany({
      where: { accountId, ...(statusParam === 'all' ? {} : { status: statusParam }) },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      data: templates.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        language: t.language,
        header_type: t.headerType,
        header_content: t.headerContent,
        header_media_url: t.headerMediaUrl,
        body_text: t.bodyText,
        body_variable_count: extractVariableIndices(t.bodyText).length,
        footer_text: t.footerText,
        buttons: t.buttons,
        sample_values: t.sampleValues,
        status: t.status,
        rejection_reason: t.rejectionReason,
        quality_score: t.qualityScore,
        submission_error: t.submissionError,
        meta_template_id: t.metaTemplateId,
        last_submitted_at: t.lastSubmittedAt,
        created_at: t.createdAt,
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
      | (TemplatePayload & { workspace_id?: unknown })
      | null;
    if (!body || typeof body.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canEditSettings(membership.role)) {
      throw new SessionError('Only owners and admins can submit templates', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ error: 'Connect a WhatsApp number first (Settings → WhatsApp)' }, { status: 400 });
    }

    try {
      const result = await submitTemplate(accountId, body);
      return NextResponse.json({ data: { template: result.template, dry_run: result.dry_run } }, { status: 201 });
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

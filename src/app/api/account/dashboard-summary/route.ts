// ============================================================
// GET /api/account/dashboard-summary?workspace_id=<id>
//
// Aggregate counts for the dashboard's stat tiles — one round trip
// instead of the page fetching contacts/conversations/deals
// separately just to count them. No chart library (recharts isn't
// installed post-trim) — plain numbers for now; time-series charts
// are a follow-up if this becomes the primary landing page.
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
      return NextResponse.json({
        data: {
          connected: false,
          contacts: 0,
          conversations: 0,
          open_deals: 0,
          open_deals_value: 0,
          won_deals_value: 0,
        },
      });
    }

    const [contacts, conversations, openDeals, wonDeals] = await Promise.all([
      prisma.contact.count({ where: { accountId } }),
      prisma.conversation.count({ where: { accountId } }),
      prisma.deal.aggregate({ where: { accountId, status: 'open' }, _count: true, _sum: { value: true } }),
      prisma.deal.aggregate({ where: { accountId, status: 'won' }, _sum: { value: true } }),
    ]);

    return NextResponse.json({
      data: {
        connected: true,
        contacts,
        conversations,
        open_deals: openDeals._count,
        open_deals_value: openDeals._sum.value ?? 0,
        won_deals_value: wonDeals._sum.value ?? 0,
      },
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

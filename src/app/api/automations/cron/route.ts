// ============================================================
// GET /api/automations/cron
//
// Drains due `wait`-step suspensions. Meant to be hit by an external
// scheduler (cron job, Vercel Cron, etc.) every minute or so — this
// endpoint only does one sweep per call, it doesn't loop or schedule
// itself. Not wired up to an actual scheduler here; that's a
// deployment decision, same as Broadcasts' fire-and-forget send loop
// was scoped as "the endpoint exists, the trigger doesn't" already.
//
// Auth: shared secret header, not a session/API key — this is a
// machine-to-machine trigger, not a user-facing route.
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resumePendingExecution } from '@/lib/whatsapp/automations/engine';

const BATCH_SIZE = 50;

function isAuthorized(request: Request): boolean {
  const provided = request.headers.get('x-cron-secret') ?? '';
  const expected = process.env.AUTOMATION_CRON_SECRET ?? '';
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const due = await prisma.automationPendingExecution.findMany({
    where: { status: 'pending', runAt: { lte: new Date() } },
    take: BATCH_SIZE,
    orderBy: { runAt: 'asc' },
  });

  let claimed = 0;
  for (const row of due) {
    // Conditional update as a claim/lock — if another worker already
    // moved this row past 'pending', this no-ops instead of double-processing.
    const result = await prisma.automationPendingExecution.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'running' },
    });
    if (result.count === 0) continue;
    claimed++;
    try {
      await resumePendingExecution(row.id);
    } catch (err) {
      console.error(`[automations/cron] resume failed for ${row.id}:`, err);
      await prisma.automationPendingExecution.updateMany({
        where: { id: row.id, status: 'running' },
        data: { status: 'failed' },
      });
    }
  }

  return NextResponse.json({ data: { found: due.length, claimed } });
}

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';

/**
 * GET /api/v1/wallet/transactions?account_id=...&limit=25&cursor=...
 * Returns paginated transaction history (newest first).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'wallet:manage');
    const params = new URL(request.url).searchParams;

    const accountId = params.get('account_id');
    if (!accountId) throw badRequest('account_id is required');
    await requireAccountAccess(ctx, accountId);

    const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '25', 10) || 25, 1), 100);
    const cursor = params.get('cursor');

    const transactions = await prisma.walletTransaction.findMany({
      where: { accountId, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = transactions.length > limit;
    const page = hasMore ? transactions.slice(0, limit) : transactions;
    const nextCursor = hasMore ? page[page.length - 1]!.createdAt.toISOString() : null;

    return ok({
      transactions: page.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balance: t.balance,
        description: t.description,
        created_at: t.createdAt.toISOString(),
      })),
      next_cursor: nextCursor,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

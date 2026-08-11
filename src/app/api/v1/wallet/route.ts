import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';

/**
 * GET /api/v1/wallet?account_id=...
 * Returns the account's credit balance.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'wallet:manage');
    const accountId = new URL(request.url).searchParams.get('account_id');
    if (!accountId) throw badRequest('account_id is required');
    await requireAccountAccess(ctx, accountId);

    const wallet = await prisma.accountWallet.findUnique({
      where: { accountId },
    });

    return ok({
      account_id: accountId,
      balance: wallet?.balance ?? 0,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

/**
 * POST /api/v1/wallet
 * Add credits to an account's wallet.
 * Body: { account_id, amount, description? }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'wallet:manage');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest('Request body is required');

    const accountId = typeof body.account_id === 'string' ? body.account_id : null;
    if (!accountId) throw badRequest('account_id is required');
    await requireAccountAccess(ctx, accountId);

    const amount = typeof body.amount === 'number' ? Math.floor(body.amount) : null;
    if (!amount || amount <= 0) throw badRequest('amount must be a positive integer');

    const description = typeof body.description === 'string' ? body.description : null;

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.accountWallet.upsert({
        where: { accountId },
        create: { accountId, balance: amount },
        update: { balance: { increment: amount } },
      });

      await tx.walletTransaction.create({
        data: {
          accountId,
          type: 'CREDIT',
          amount,
          balance: wallet.balance,
          description,
        },
      });

      return wallet;
    });

    return ok({
      account_id: accountId,
      balance: result.balance,
      credited: amount,
    }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

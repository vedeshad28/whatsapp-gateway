// ============================================================
// GET /api/whatsapp/media/{mediaId}?account_id=<uuid>
//
// Proxies a media download from Meta using the account's stored
// token — Meta's media URLs are short-lived and require the
// requesting app's Bearer token, so callers can't hit them directly.
// Auth: API key with `messages:read`.
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { mediaId } = await params;
    if (!mediaId) return fail('bad_request', 'Media ID is required', 400);

    const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
    if (!accountId) return fail('bad_request', "'account_id' query param is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    const config = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
    if (!config) return fail('bad_request', 'WhatsApp not configured', 400);

    const accessToken = decrypt(config.accessToken);
    const mediaInfo = await getMediaUrl({ mediaId, accessToken });
    const { buffer, contentType } = await downloadMedia({ downloadUrl: mediaInfo.url, accessToken });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

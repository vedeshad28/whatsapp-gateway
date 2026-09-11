// ============================================================
// Broadcast dispatch — the fire-and-forget send loop behind
// POST /api/account/broadcasts. Reuses the exact same per-message
// primitives the gateway's own send paths use
// (resolveConversationByPhone + sendMessageToConversation) — a
// broadcast is just that, called once per recipient.
//
// Runs in-process, sequentially, with a small delay between sends so
// a large broadcast doesn't hammer Meta's API. This assumes the app
// is deployed as a long-lived `next start` process (true for this
// project's Docker/VPS setup) — on a serverless platform the process
// could be torn down after the HTTP response returns, silently
// stopping the broadcast partway through. If the process restarts
// mid-broadcast, any still-`pending` BroadcastRecipient rows stay
// pending with no automatic resume; a real job queue is a follow-up,
// not built here.
// ============================================================

import { prisma } from '@/lib/db';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';

const SEND_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the per-recipient body {{n}} array from fixed values + the contact's own name at `useContactNameVar`, if set. */
function buildBodyParams(
  bodyVariableCount: number,
  bodyParams: Record<string, string> | null,
  useContactNameVar: number | null,
  contactName: string | null,
  contactPhone: string
): string[] {
  const body: string[] = [];
  for (let i = 1; i <= bodyVariableCount; i++) {
    if (useContactNameVar === i) {
      body.push(contactName ?? contactPhone);
    } else {
      body.push(bodyParams?.[String(i)] ?? '');
    }
  }
  return body;
}

/**
 * Send a broadcast's pending recipients, one at a time, updating each
 * BroadcastRecipient row and the parent Broadcast's rollup counts as
 * it goes. Never throws — a single recipient's failure is recorded on
 * that row and the loop continues.
 */
export async function dispatchBroadcast(broadcastId: string): Promise<void> {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    include: { template: true },
  });
  if (!broadcast) return;

  const bodyVariableCount = (broadcast.template.bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
  const bodyParams = (broadcast.bodyParams as Record<string, string> | null) ?? null;

  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: 'pending' },
    include: { contact: true },
  });

  let sentCount = 0;

  for (const recipient of recipients) {
    try {
      const resolved = await resolveConversationByPhone(
        broadcast.accountId,
        recipient.contact.phone,
        recipient.contact.name
      );

      const result = await sendMessageToConversation(broadcast.accountId, {
        conversationId: resolved.conversationId,
        messageType: 'template',
        templateName: broadcast.template.name,
        templateLanguage: broadcast.template.language,
        templateMessageParams: {
          body: buildBodyParams(
            bodyVariableCount,
            bodyParams,
            broadcast.useContactNameVar,
            recipient.contact.name,
            recipient.contact.phone
          ),
          // Same value for every recipient — a broadcast sends
          // identical content to everyone, unlike salon-saas's
          // per-customer invoice PDFs (see this file's header
          // comment). Only sent when set; buildHeaderComponent falls
          // back to the template's own header_media_url when absent.
          headerText: broadcast.headerText ?? undefined,
          headerMediaUrl: broadcast.headerMediaUrl ?? undefined,
          headerFilename: broadcast.headerFilename ?? undefined,
        },
      });

      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: 'sent', messageId: result.messageId, sentAt: new Date() },
      });
      sentCount++;
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { sentCount: { increment: 1 } } });
    } catch (err) {
      const message =
        err instanceof SendMessageError ? err.message : err instanceof Error ? err.message : 'Unknown error';
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: 'failed', errorMessage: message },
      });
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { failedCount: { increment: 1 } } });
      console.warn(`[broadcast-send] recipient ${recipient.id} failed:`, message);
    }

    await sleep(SEND_DELAY_MS);
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: sentCount > 0 ? 'completed' : 'failed',
      completedAt: new Date(),
    },
  });
}

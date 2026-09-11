// ============================================================
// Automations engine — trigger → (branching) step-tree execution.
// Ported from wacrm's pre-trim src/lib/automations/engine.ts onto
// Prisma. Business logic (trigger matching, condition evaluation,
// per-step behavior, wait-step suspension) is unchanged from the
// researched original; only the data-access layer moved from a
// Supabase service-role client to Prisma, and sends now go through
// this codebase's own `sendMessageToConversation` (senderType: 'bot')
// instead of a bespoke automation-only sender — this repo already
// consolidated sending into one function, so there's no need for the
// separate parallel sender pre-trim had.
//
// Public contract: `runAutomationsForTrigger` never throws — every
// caller (the webhook handler) fires it with `.catch()` only, so a
// slow or failing automation can never block a webhook's 200 OK to
// Meta or delay the response salon-saas depends on.
// ============================================================

import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export type AutomationTriggerType =
  | 'new_message_received'
  | 'first_inbound_message'
  | 'keyword_match'
  | 'new_contact_created'
  | 'conversation_assigned'
  | 'tag_added'
  | 'time_based'
  | 'interactive_reply';

export interface AutomationContext {
  message_text?: string;
  conversation_id?: string;
  interactive_reply_id?: string;
}

export interface DispatchInput {
  accountId: string;
  triggerType: AutomationTriggerType;
  contactId?: string;
  context?: AutomationContext;
}

interface StepRow {
  id: string;
  automationId: string;
  parentStepId: string | null;
  branch: string | null;
  stepType: string;
  stepConfig: Prisma.JsonValue;
  position: number;
}

interface StepExecutionResult {
  stepId: string;
  stepType: string;
  status: 'ok' | 'skipped' | 'error';
  detail?: string;
}

/** Public dispatch entrypoint. Never throws — callers `.catch()` only. */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    if (input.contactId) {
      const contact = await prisma.contact.findUnique({ where: { id: input.contactId } });
      if (!contact || contact.accountId !== input.accountId) return;
    }

    const automations = await prisma.automation.findMany({
      where: { accountId: input.accountId, triggerType: input.triggerType, isActive: true },
    });

    for (const automation of automations) {
      if (!triggerMatches(automation.triggerConfig, input)) continue;
      await executeAutomation(automation.id, input);
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err);
  }
}

function triggerMatches(
  triggerConfig: Prisma.JsonValue,
  input: DispatchInput
): boolean {
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>;

  if (input.triggerType === 'keyword_match') {
    const keywords = Array.isArray(cfg.keywords) ? (cfg.keywords as string[]) : [];
    const matchType = cfg.match_type === 'exact' ? 'exact' : 'contains';
    const caseSensitive = cfg.case_sensitive === true;
    const text = input.context?.message_text ?? '';
    const haystack = caseSensitive ? text : text.toLowerCase();
    return keywords.some((kw) => {
      const needle = caseSensitive ? kw : kw.toLowerCase();
      if (!needle) return false;
      return matchType === 'exact' ? haystack === needle : haystack.includes(needle);
    });
  }

  if (input.triggerType === 'interactive_reply') {
    const replyIds = Array.isArray(cfg.reply_ids) ? (cfg.reply_ids as string[]) : [];
    return !!input.context?.interactive_reply_id && replyIds.includes(input.context.interactive_reply_id);
  }

  // Every other trigger type matches unconditionally — the DB query
  // already filtered by accountId + triggerType + isActive.
  return true;
}

async function executeAutomation(automationId: string, input: DispatchInput): Promise<void> {
  const log = await prisma.automationLog.create({
    data: {
      automationId,
      contactId: input.contactId ?? null,
      triggerEvent: input.triggerType,
      status: 'success',
      stepsExecuted: [],
    },
  });

  const result = await executeStepsFrom({
    automationId,
    logId: log.id,
    parentStepId: null,
    branch: null,
    startPosition: 0,
    contactId: input.contactId ?? null,
    context: input.context ?? {},
  });

  await prisma.automationLog.update({
    where: { id: log.id },
    data: {
      status: result.suspended ? 'partial' : result.failed ? 'failed' : 'success',
      stepsExecuted: result.executed as unknown as Prisma.InputJsonValue,
      errorMessage: result.errorMessage,
    },
  });

  await prisma.automation.update({
    where: { id: automationId },
    data: { executionCount: { increment: 1 }, lastExecutedAt: new Date() },
  });
}

interface ExecuteArgs {
  automationId: string;
  logId: string;
  parentStepId: string | null;
  branch: string | null;
  startPosition: number;
  contactId: string | null;
  context: AutomationContext;
}

interface ExecuteResult {
  executed: StepExecutionResult[];
  suspended: boolean;
  failed: boolean;
  errorMessage?: string;
}

/** Resumed by the cron sweep for a `wait`-suspended run — same walk, different entry point. */
export async function resumePendingExecution(pendingId: string): Promise<void> {
  const pending = await prisma.automationPendingExecution.findUnique({ where: { id: pendingId } });
  if (!pending || pending.status !== 'running') return;

  const context = (pending.context ?? {}) as AutomationContext;
  const result = await executeStepsFrom({
    automationId: pending.automationId,
    logId: pending.logId,
    parentStepId: pending.parentStepId,
    branch: pending.branch,
    startPosition: pending.nextStepPosition,
    contactId: pending.contactId,
    context,
  });

  await prisma.automationPendingExecution.update({
    where: { id: pending.id },
    data: { status: result.failed ? 'failed' : 'done' },
  });

  if (!result.suspended) {
    const existingLog = await prisma.automationLog.findUnique({ where: { id: pending.logId } });
    const priorSteps = (existingLog?.stepsExecuted as unknown as StepExecutionResult[] | null) ?? [];
    await prisma.automationLog.update({
      where: { id: pending.logId },
      data: {
        status: result.failed ? 'failed' : 'success',
        stepsExecuted: [...priorSteps, ...result.executed] as unknown as Prisma.InputJsonValue,
        errorMessage: result.errorMessage,
      },
    });
  }
}

async function executeStepsFrom(args: ExecuteArgs): Promise<ExecuteResult> {
  const steps = await prisma.automationStep.findMany({
    where: { automationId: args.automationId, parentStepId: args.parentStepId, branch: args.branch },
    orderBy: { position: 'asc' },
  });

  const executed: StepExecutionResult[] = [];

  for (const step of steps) {
    if (step.position < args.startPosition) continue;

    if (step.stepType === 'wait') {
      const waitCfg = (step.stepConfig ?? {}) as { amount?: number; unit?: 'minutes' | 'hours' | 'days' };
      const ms = waitDurationMs(waitCfg.amount ?? 0, waitCfg.unit ?? 'minutes');
      await prisma.automationPendingExecution.create({
        data: {
          automationId: args.automationId,
          contactId: args.contactId,
          logId: args.logId,
          parentStepId: args.parentStepId,
          branch: args.branch,
          nextStepPosition: step.position + 1,
          context: args.context as unknown as Prisma.InputJsonValue,
          status: 'pending',
          runAt: new Date(Date.now() + ms),
        },
      });
      executed.push({ stepId: step.id, stepType: step.stepType, status: 'ok', detail: 'suspended (wait)' });
      return { executed, suspended: true, failed: false };
    }

    if (step.stepType === 'condition') {
      let matched: boolean;
      try {
        matched = await evaluateCondition(step.stepConfig, args);
      } catch (err) {
        executed.push({ stepId: step.id, stepType: step.stepType, status: 'error', detail: errMsg(err) });
        return { executed, suspended: false, failed: true, errorMessage: errMsg(err) };
      }
      executed.push({ stepId: step.id, stepType: step.stepType, status: 'ok', detail: matched ? 'yes' : 'no' });
      const branchResult = await executeStepsFrom({
        ...args,
        parentStepId: step.id,
        branch: matched ? 'yes' : 'no',
        startPosition: 0,
      });
      executed.push(...branchResult.executed);
      if (branchResult.suspended || branchResult.failed) {
        return { executed, suspended: branchResult.suspended, failed: branchResult.failed, errorMessage: branchResult.errorMessage };
      }
      continue;
    }

    try {
      const detail = await runStep(step, args);
      executed.push({ stepId: step.id, stepType: step.stepType, status: 'ok', detail });
    } catch (err) {
      executed.push({ stepId: step.id, stepType: step.stepType, status: 'error', detail: errMsg(err) });
      return { executed, suspended: false, failed: true, errorMessage: errMsg(err) };
    }
  }

  return { executed, suspended: false, failed: false };
}

function waitDurationMs(amount: number, unit: 'minutes' | 'hours' | 'days'): number {
  const perUnit = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[unit];
  return Math.max(0, amount) * perUnit;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function resolveConversationId(args: ExecuteArgs, accountId: string): Promise<string | null> {
  if (args.context.conversation_id) return args.context.conversation_id;
  if (!args.contactId) return null;
  const conversation = await prisma.conversation.findFirst({
    where: { accountId, contactId: args.contactId },
    orderBy: { createdAt: 'asc' },
  });
  return conversation?.id ?? null;
}

function interpolate(template: string, args: ExecuteArgs, vars?: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    if (path === 'message.text') return args.context.message_text ?? '';
    if (path.startsWith('vars.')) {
      const key = path.slice('vars.'.length);
      return vars?.[key] != null ? String(vars[key]) : '';
    }
    return match;
  });
}

async function runStep(step: StepRow, args: ExecuteArgs): Promise<string> {
  const cfg = (step.stepConfig ?? {}) as Record<string, unknown>;

  // Need the account for every send/tag/deal step — resolved once per
  // step rather than threaded through ExecuteArgs, since only a
  // minority of step types need it.
  const automation = await prisma.automation.findUniqueOrThrow({
    where: { id: step.automationId },
    select: { accountId: true },
  });
  const accountId = automation.accountId;

  switch (step.stepType) {
    case 'send_message': {
      const conversationId = await resolveConversationId(args, accountId);
      if (!conversationId) return 'skipped: no conversation';
      const text = interpolate(String(cfg.text ?? ''), args);
      await sendMessageToConversation(accountId, {
        conversationId,
        messageType: 'text',
        contentText: text,
        senderType: 'bot',
      });
      return 'sent';
    }
    case 'send_buttons':
    case 'send_list': {
      const conversationId = await resolveConversationId(args, accountId);
      if (!conversationId) return 'skipped: no conversation';
      await sendMessageToConversation(accountId, {
        conversationId,
        messageType: 'interactive',
        interactivePayload: cfg as unknown as InteractiveMessagePayload,
        senderType: 'bot',
      });
      return 'sent';
    }
    case 'send_template': {
      const conversationId = await resolveConversationId(args, accountId);
      if (!conversationId) return 'skipped: no conversation';
      const variables = (cfg.variables ?? {}) as Record<string, string>;
      // Numeric sort, not lexicographic — "10" must sort after "2", or
      // Meta's positional {{n}} placeholders get scrambled.
      const body = Object.keys(variables)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => variables[k]);
      await sendMessageToConversation(accountId, {
        conversationId,
        messageType: 'template',
        templateName: String(cfg.template_name ?? ''),
        templateLanguage: cfg.language ? String(cfg.language) : 'en_US',
        templateMessageParams: { body },
        senderType: 'bot',
      });
      return 'sent';
    }
    case 'add_tag':
    case 'remove_tag': {
      if (!args.contactId) return 'skipped: no contact';
      const tagId = String(cfg.tag_id ?? '');
      if (!tagId) return 'skipped: no tag_id';
      if (step.stepType === 'add_tag') {
        await prisma.contactTag.upsert({
          where: { contactId_tagId: { contactId: args.contactId, tagId } },
          create: { contactId: args.contactId, tagId },
          update: {},
        });
      } else {
        await prisma.contactTag.deleteMany({ where: { contactId: args.contactId, tagId } });
      }
      return step.stepType;
    }
    case 'assign_conversation': {
      // 'round_robin' is a stub inherited from pre-trim — it only ever
      // assigns the automation's own author, same as upstream. A real
      // round-robin scheduler was never built there either; not
      // inventing one here. Conversation assignment itself isn't
      // modeled on this schema yet, so this step is a documented no-op
      // until that lands — logged, not silently dropped.
      return 'assign_conversation: no-op (conversation assignment not modeled yet)';
    }
    case 'update_contact_field': {
      if (!args.contactId) return 'skipped: no contact';
      const field = String(cfg.field ?? '');
      const value = cfg.value != null ? String(cfg.value) : null;
      if (field === 'name' || field === 'email' || field === 'company') {
        await prisma.contact.update({ where: { id: args.contactId }, data: { [field]: value } });
        return `updated ${field}`;
      }
      return `skipped: unsupported field "${field}"`;
    }
    case 'create_deal': {
      const pipelineId = String(cfg.pipeline_id ?? '');
      const stageId = String(cfg.stage_id ?? '');
      if (!pipelineId || !stageId) return 'skipped: missing pipeline/stage';
      await prisma.deal.create({
        data: {
          accountId,
          pipelineId,
          stageId,
          contactId: args.contactId,
          title: interpolate(String(cfg.title ?? 'New deal'), args),
          value: typeof cfg.value === 'number' ? cfg.value : 0,
        },
      });
      return 'deal created';
    }
    case 'send_webhook': {
      const url = String(cfg.url ?? '');
      if (!url || !(await isDeliverableUrl(url))) {
        throw new Error(`send_webhook: URL is not safely deliverable: ${url}`);
      }
      const bodyTemplate = cfg.body_template ? String(cfg.body_template) : null;
      const body = bodyTemplate ? interpolate(bodyTemplate, args) : JSON.stringify(args.context);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...((cfg.headers as Record<string, string>) ?? {}) },
          body,
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      return 'webhook sent';
    }
    case 'close_conversation': {
      const conversationId = await resolveConversationId(args, accountId);
      if (!conversationId) return 'skipped: no conversation';
      await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'closed' } });
      return 'conversation closed';
    }
    default:
      return `unknown step: ${step.stepType}`;
  }
}

async function evaluateCondition(stepConfig: Prisma.JsonValue, args: ExecuteArgs): Promise<boolean> {
  const cfg = (stepConfig ?? {}) as {
    subject?: 'tag_presence' | 'contact_field' | 'message_content' | 'time_of_day';
    operand?: string;
    value?: string;
  };

  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false;
      const row = await prisma.contactTag.findUnique({
        where: { contactId_tagId: { contactId: args.contactId, tagId: cfg.operand } },
      });
      return !!row;
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false;
      if (cfg.operand !== 'name' && cfg.operand !== 'phone' && cfg.operand !== 'email' && cfg.operand !== 'company') {
        return false;
      }
      const contact = await prisma.contact.findUnique({ where: { id: args.contactId } });
      const fieldValue = contact ? String(contact[cfg.operand] ?? '') : '';
      return fieldValue === (cfg.value ?? '');
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toLowerCase();
      return text.includes((cfg.value ?? '').toLowerCase());
    }
    case 'time_of_day': {
      if (!cfg.operand || !cfg.operand.includes('-')) return false;
      const [from, to] = cfg.operand.split('-');
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const toMinutes = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };
      const fromM = toMinutes(from);
      const toM = toMinutes(to);
      if (fromM <= toM) return nowMinutes >= fromM && nowMinutes <= toM;
      // Overnight wraparound, e.g. 22:00-06:00.
      return nowMinutes >= fromM || nowMinutes <= toM;
    }
    default:
      return false;
  }
}

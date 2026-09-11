// ============================================================
// Pre-activation validation — mirrors the required-field checks the
// engine's runStep()/triggerMatches() rely on at runtime, so turning
// is_active on for a broken automation is rejected up front instead
// of silently producing failed AutomationLog rows later. Ported from
// wacrm's pre-trim src/lib/automations/validate.ts.
// ============================================================

import { validateInteractivePayload, type InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { BuilderStep } from './steps-tree';

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateTriggerForActivation(
  triggerType: string,
  triggerConfig: Record<string, unknown>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (triggerType === 'keyword_match') {
    const keywords = Array.isArray(triggerConfig.keywords) ? triggerConfig.keywords : [];
    if (keywords.length === 0 || !keywords.some((k) => typeof k === 'string' && k.trim())) {
      issues.push({ path: 'trigger_config.keywords', message: 'At least one keyword is required' });
    }
  }
  if (triggerType === 'tag_added' && !triggerConfig.tag_id) {
    issues.push({ path: 'trigger_config.tag_id', message: 'A tag is required' });
  }
  if (triggerType === 'time_based' && !triggerConfig.schedule) {
    issues.push({ path: 'trigger_config.schedule', message: 'A schedule is required' });
  }
  if (triggerType === 'interactive_reply') {
    const replyIds = Array.isArray(triggerConfig.reply_ids) ? triggerConfig.reply_ids : [];
    if (replyIds.length === 0) {
      issues.push({ path: 'trigger_config.reply_ids', message: 'At least one reply id is required' });
    }
  }

  return issues;
}

export function validateStepsForActivation(steps: BuilderStep[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function walk(list: BuilderStep[], pathPrefix: string) {
    list.forEach((step, index) => {
      const path = `${pathPrefix}[${index}]`;
      const cfg = step.stepConfig;

      switch (step.stepType) {
        case 'send_message':
          if (!cfg.text || typeof cfg.text !== 'string' || !cfg.text.trim()) {
            issues.push({ path: `${path}.text`, message: 'Message text is required' });
          }
          break;
        case 'send_buttons':
        case 'send_list': {
          const result = validateInteractivePayload(cfg as unknown as InteractiveMessagePayload);
          if (!result.ok) issues.push({ path, message: result.error });
          break;
        }
        case 'send_template':
          if (!cfg.template_name || typeof cfg.template_name !== 'string') {
            issues.push({ path: `${path}.template_name`, message: 'A template is required' });
          }
          break;
        case 'add_tag':
        case 'remove_tag':
          if (!cfg.tag_id) issues.push({ path: `${path}.tag_id`, message: 'A tag is required' });
          break;
        case 'update_contact_field':
          if (!cfg.field || !['name', 'email', 'company'].includes(String(cfg.field))) {
            issues.push({ path: `${path}.field`, message: 'A supported contact field is required' });
          }
          break;
        case 'create_deal':
          if (!cfg.pipeline_id || !cfg.stage_id) {
            issues.push({ path: `${path}.pipeline_id`, message: 'A pipeline and stage are required' });
          }
          break;
        case 'wait':
          if (typeof cfg.amount !== 'number' || cfg.amount <= 0) {
            issues.push({ path: `${path}.amount`, message: 'A positive duration is required' });
          }
          break;
        case 'send_webhook':
          if (!cfg.url || typeof cfg.url !== 'string') {
            issues.push({ path: `${path}.url`, message: 'A webhook URL is required' });
          }
          break;
        case 'condition':
          if (!cfg.subject) {
            issues.push({ path: `${path}.subject`, message: 'A condition subject is required' });
          }
          if (step.branches) {
            walk(step.branches.yes, `${path}.branches.yes`);
            walk(step.branches.no, `${path}.branches.no`);
          }
          break;
        default:
          break;
      }
    });
  }

  walk(steps, 'steps');
  return issues;
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MessageSquare, List, FileText, Tag, TagIcon, UserPlus, Pencil, Briefcase, Clock,
  GitBranch, Webhook, XCircle, Trash2, ChevronUp, ChevronDown, Plus, ArrowLeft, Loader2,
} from 'lucide-react';
import type { BuilderStep } from '@/lib/whatsapp/automations/steps-tree';

interface UIStep {
  cid: string;
  stepType: string;
  stepConfig: Record<string, unknown>;
  branches?: { yes: UIStep[]; no: UIStep[] };
}

function withCids(steps: BuilderStep[]): UIStep[] {
  return steps.map((s) => ({
    cid: crypto.randomUUID(),
    stepType: s.stepType,
    stepConfig: s.stepConfig,
    branches: s.branches ? { yes: withCids(s.branches.yes), no: withCids(s.branches.no) } : undefined,
  }));
}

function stripCids(steps: UIStep[]): BuilderStep[] {
  return steps.map((s) => ({
    stepType: s.stepType,
    stepConfig: s.stepConfig,
    ...(s.branches ? { branches: { yes: stripCids(s.branches.yes), no: stripCids(s.branches.no) } } : {}),
  }));
}

const TRIGGER_OPTIONS: { value: string; label: string }[] = [
  { value: 'new_message_received', label: 'New message received' },
  { value: 'first_inbound_message', label: "Contact's first message" },
  { value: 'keyword_match', label: 'Keyword match' },
  { value: 'new_contact_created', label: 'New contact created' },
  { value: 'conversation_assigned', label: 'Conversation assigned' },
  { value: 'tag_added', label: 'Tag added' },
  { value: 'time_based', label: 'Time-based' },
  { value: 'interactive_reply', label: 'Button/list reply' },
];

const STEP_META: Record<string, { label: string; icon: typeof MessageSquare; border: string }> = {
  send_message: { label: 'Send message', icon: MessageSquare, border: 'border-l-blue-500' },
  send_buttons: { label: 'Send buttons', icon: List, border: 'border-l-blue-500' },
  send_list: { label: 'Send list', icon: List, border: 'border-l-blue-500' },
  send_template: { label: 'Send template', icon: FileText, border: 'border-l-blue-500' },
  add_tag: { label: 'Add tag', icon: Tag, border: 'border-l-emerald-500' },
  remove_tag: { label: 'Remove tag', icon: TagIcon, border: 'border-l-emerald-500' },
  assign_conversation: { label: 'Assign conversation', icon: UserPlus, border: 'border-l-emerald-500' },
  update_contact_field: { label: 'Update contact field', icon: Pencil, border: 'border-l-emerald-500' },
  create_deal: { label: 'Create deal', icon: Briefcase, border: 'border-l-emerald-500' },
  wait: { label: 'Wait', icon: Clock, border: 'border-l-amber-500' },
  condition: { label: 'Condition', icon: GitBranch, border: 'border-l-violet-500' },
  send_webhook: { label: 'Send webhook', icon: Webhook, border: 'border-l-amber-500' },
  close_conversation: { label: 'Close conversation', icon: XCircle, border: 'border-l-rose-500' },
};

const ADDABLE_STEPS = Object.keys(STEP_META);

interface Resources {
  tags: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  /** This app has one pipeline per account (a singleton, auto-created on first read). */
  pipeline: { id: string; name: string; stages: { id: string; name: string }[] } | null;
}

function useResources(workspaceId: string | null): Resources {
  const [resources, setResources] = useState<Resources>({ tags: [], templates: [], pipeline: null });
  useEffect(() => {
    if (!workspaceId) return;
    Promise.all([
      fetch(`/api/account/tags?workspace_id=${workspaceId}`).then((r) => r.json()),
      fetch(`/api/account/templates?workspace_id=${workspaceId}`).then((r) => r.json()),
      fetch(`/api/account/pipelines?workspace_id=${workspaceId}`).then((r) => r.json()),
    ]).then(([tagsJson, templatesJson, pipelineJson]) => {
      setResources({
        tags: tagsJson.data ?? [],
        templates: templatesJson.data ?? [],
        pipeline: pipelineJson.data ?? null,
      });
    });
  }, [workspaceId]);
  return resources;
}

function AddButton({ onSelect }: { onSelect: (stepType: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex size-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
        aria-label="Add step"
      >
        <Plus className="size-3.5" />
      </button>
      {open && (
        <div className="absolute top-8 z-10 grid w-56 grid-cols-1 gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md">
          {ADDABLE_STEPS.map((type) => {
            const meta = STEP_META[type];
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onSelect(type);
                  setOpen(false);
                }}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
              >
                <Icon className="size-3.5" />
                {meta.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepConfigForm({
  step,
  onChange,
  resources,
}: {
  step: UIStep;
  onChange: (config: Record<string, unknown>) => void;
  resources: Resources;
}) {
  const cfg = step.stepConfig;
  const set = (patch: Record<string, unknown>) => onChange({ ...cfg, ...patch });

  switch (step.stepType) {
    case 'send_message':
      return (
        <Textarea
          value={String(cfg.text ?? '')}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Message text — {{message.text}} and {{vars.key}} supported"
          rows={3}
        />
      );
    case 'send_buttons':
      return (
        <div className="grid gap-2">
          <Textarea
            value={String(cfg.body ?? '')}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Body text"
            rows={2}
          />
          <p className="text-xs text-muted-foreground">
            Up to 3 buttons, one per line, as "id | title" (id is echoed back when tapped).
          </p>
          <Textarea
            value={((cfg.buttons as { id: string; title: string }[]) ?? []).map((b) => `${b.id} | ${b.title}`).join('\n')}
            onChange={(e) =>
              set({
                kind: 'buttons',
                buttons: e.target.value
                  .split('\n')
                  .map((line) => line.split('|').map((s) => s.trim()))
                  .filter(([id]) => id)
                  .slice(0, 3)
                  .map(([id, title]) => ({ id, title: title ?? id })),
              })
            }
            placeholder="yes | Yes please&#10;no | No thanks"
            rows={3}
          />
        </div>
      );
    case 'send_list':
      return (
        <div className="grid gap-2">
          <Textarea
            value={String(cfg.body ?? '')}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Body text"
            rows={2}
          />
          <Input
            value={String(cfg.button_label ?? '')}
            onChange={(e) => set({ button_label: e.target.value })}
            placeholder="Button label (e.g. 'Choose an option')"
          />
          <p className="text-xs text-muted-foreground">Up to 10 rows total, one per line, as "id | title".</p>
          <Textarea
            value={(((cfg.sections as { rows: { id: string; title: string }[] }[]) ?? [])[0]?.rows ?? [])
              .map((r) => `${r.id} | ${r.title}`)
              .join('\n')}
            onChange={(e) =>
              set({
                kind: 'list',
                sections: [
                  {
                    rows: e.target.value
                      .split('\n')
                      .map((line) => line.split('|').map((s) => s.trim()))
                      .filter(([id]) => id)
                      .slice(0, 10)
                      .map(([id, title]) => ({ id, title: title ?? id })),
                  },
                ],
              })
            }
            placeholder="opt1 | Option one&#10;opt2 | Option two"
            rows={3}
          />
        </div>
      );
    case 'send_template':
      return (
        <div className="grid gap-2">
          <Select
            value={String(cfg.template_name ?? '')}
            onValueChange={(v) => v && set({ template_name: v })}
          >
            <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
            <SelectContent>
              {resources.templates.map((t) => (
                <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Body variables, one per line as "1=value" (position=value; supports {'{{vars.key}}'}).
          </p>
          <Textarea
            value={Object.entries((cfg.variables as Record<string, string>) ?? {})
              .map(([k, v]) => `${k}=${v}`)
              .join('\n')}
            onChange={(e) =>
              set({
                variables: Object.fromEntries(
                  e.target.value
                    .split('\n')
                    .map((line) => line.split('='))
                    .filter(([k]) => k?.trim())
                    .map(([k, ...rest]) => [k.trim(), rest.join('=').trim()])
                ),
              })
            }
            placeholder={'1=Hi {{vars.name}}\n2=your appointment'}
            rows={3}
          />
        </div>
      );
    case 'add_tag':
    case 'remove_tag':
      return (
        <Select value={String(cfg.tag_id ?? '')} onValueChange={(v) => v && set({ tag_id: v })}>
          <SelectTrigger><SelectValue placeholder="Choose a tag" /></SelectTrigger>
          <SelectContent>
            {resources.tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'assign_conversation':
      return (
        <p className="text-xs text-muted-foreground">
          Not yet wired to a real assignment model — this step logs a no-op for now.
        </p>
      );
    case 'update_contact_field':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select value={String(cfg.field ?? '')} onValueChange={(v) => v && set({ field: v })}>
            <SelectTrigger><SelectValue placeholder="Field" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="company">Company</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={String(cfg.value ?? '')}
            onChange={(e) => set({ value: e.target.value })}
            placeholder="New value"
          />
        </div>
      );
    case 'create_deal':
      return (
        <div className="grid gap-2">
          <Input value={String(cfg.title ?? '')} onChange={(e) => set({ title: e.target.value })} placeholder="Deal title" />
          <Select
            value={String(cfg.stage_id ?? '')}
            onValueChange={(v) => v && set({ pipeline_id: resources.pipeline?.id, stage_id: v })}
          >
            <SelectTrigger><SelectValue placeholder={resources.pipeline?.name ?? 'Stage'} /></SelectTrigger>
            <SelectContent>
              {(resources.pipeline?.stages ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case 'wait':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min={1}
            value={String(cfg.amount ?? '')}
            onChange={(e) => set({ amount: Number(e.target.value) })}
            placeholder="Amount"
          />
          <Select value={String(cfg.unit ?? 'minutes')} onValueChange={(v) => v && set({ unit: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    case 'condition':
      return (
        <div className="grid gap-2">
          <Select value={String(cfg.subject ?? '')} onValueChange={(v) => v && set({ subject: v })}>
            <SelectTrigger><SelectValue placeholder="Condition subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tag_presence">Contact has tag</SelectItem>
              <SelectItem value="contact_field">Contact field equals</SelectItem>
              <SelectItem value="message_content">Message contains</SelectItem>
              <SelectItem value="time_of_day">Time of day is between</SelectItem>
            </SelectContent>
          </Select>
          {cfg.subject === 'tag_presence' && (
            <Select value={String(cfg.operand ?? '')} onValueChange={(v) => v && set({ operand: v })}>
              <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                {resources.tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {cfg.subject === 'contact_field' && (
            <div className="grid grid-cols-2 gap-2">
              <Select value={String(cfg.operand ?? '')} onValueChange={(v) => v && set({ operand: v })}>
                <SelectTrigger><SelectValue placeholder="Field" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="company">Company</SelectItem>
                </SelectContent>
              </Select>
              <Input value={String(cfg.value ?? '')} onChange={(e) => set({ value: e.target.value })} placeholder="Equals..." />
            </div>
          )}
          {cfg.subject === 'message_content' && (
            <Input value={String(cfg.value ?? '')} onChange={(e) => set({ value: e.target.value })} placeholder="Contains..." />
          )}
          {cfg.subject === 'time_of_day' && (
            <Input
              value={String(cfg.operand ?? '')}
              onChange={(e) => set({ operand: e.target.value })}
              placeholder="09:00-18:00"
            />
          )}
        </div>
      );
    case 'send_webhook':
      return (
        <div className="grid gap-2">
          <Input value={String(cfg.url ?? '')} onChange={(e) => set({ url: e.target.value })} placeholder="https://..." />
          <Textarea
            value={String(cfg.body_template ?? '')}
            onChange={(e) => set({ body_template: e.target.value })}
            placeholder="Body JSON (optional — defaults to the trigger context)"
            rows={2}
          />
        </div>
      );
    case 'close_conversation':
      return <p className="text-xs text-muted-foreground">Marks the conversation as closed.</p>;
    default:
      return null;
  }
}

function StepCard({
  step,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  resources,
}: {
  step: UIStep;
  onChange: (step: UIStep) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  resources: Resources;
}) {
  const [expanded, setExpanded] = useState(true);
  const meta = STEP_META[step.stepType];
  if (!meta) return null;
  const Icon = meta.icon;

  return (
    <div className={`w-full max-w-md rounded-lg border border-l-4 border-border bg-card ${meta.border}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex-1 text-left text-sm font-medium text-foreground">
          {meta.label}
        </button>
        {onMoveUp && (
          <Button variant="ghost" size="icon-sm" onClick={onMoveUp} aria-label="Move up"><ChevronUp className="size-3.5" /></Button>
        )}
        {onMoveDown && (
          <Button variant="ghost" size="icon-sm" onClick={onMoveDown} aria-label="Move down"><ChevronDown className="size-3.5" /></Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete step"><Trash2 className="size-3.5" /></Button>
      </div>
      {expanded && (
        <div className="border-t border-border px-3 py-3">
          <StepConfigForm step={step} onChange={(stepConfig) => onChange({ ...step, stepConfig })} resources={resources} />
        </div>
      )}
    </div>
  );
}

function StepList({
  steps,
  onChange,
  resources,
}: {
  steps: UIStep[];
  onChange: (steps: UIStep[]) => void;
  resources: Resources;
}) {
  const insertAt = (index: number, stepType: string) => {
    const newStep: UIStep = {
      cid: crypto.randomUUID(),
      stepType,
      stepConfig: {},
      ...(stepType === 'condition' ? { branches: { yes: [], no: [] } } : {}),
    };
    const next = [...steps];
    next.splice(index, 0, newStep);
    onChange(next);
  };
  const updateAt = (index: number, step: UIStep) => onChange(steps.map((s, i) => (i === index ? step : s)));
  const deleteAt = (index: number) => onChange(steps.filter((_, i) => i !== index));
  const moveAt = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <AddButton onSelect={(type) => insertAt(0, type)} />
      {steps.map((step, i) => (
        <div key={step.cid} className="flex w-full flex-col items-center gap-2">
          <StepCard
            step={step}
            onChange={(updated) => updateAt(i, updated)}
            onDelete={() => deleteAt(i)}
            onMoveUp={i > 0 ? () => moveAt(i, -1) : undefined}
            onMoveDown={i < steps.length - 1 ? () => moveAt(i, 1) : undefined}
            resources={resources}
          />
          {step.stepType === 'condition' && step.branches && (
            <div className="grid w-full max-w-2xl grid-cols-2 gap-4 rounded-lg border border-dashed border-border p-3">
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs font-medium text-primary">Yes</span>
                <StepList
                  steps={step.branches.yes}
                  onChange={(yes) => updateAt(i, { ...step, branches: { ...step.branches!, yes } })}
                  resources={resources}
                />
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs font-medium text-rose-500">No</span>
                <StepList
                  steps={step.branches.no}
                  onChange={(no) => updateAt(i, { ...step, branches: { ...step.branches!, no } })}
                  resources={resources}
                />
              </div>
            </div>
          )}
          <AddButton onSelect={(type) => insertAt(i + 1, type)} />
        </div>
      ))}
    </div>
  );
}

function TriggerCard({
  triggerType,
  triggerConfig,
  onChange,
  resources,
}: {
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  onChange: (triggerType: string, triggerConfig: Record<string, unknown>) => void;
  resources: Resources;
}) {
  const set = (patch: Record<string, unknown>) => onChange(triggerType, { ...triggerConfig, ...patch });

  return (
    <div className="w-full max-w-md rounded-lg border-2 border-primary/40 bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-primary uppercase">Trigger</div>
      <div className="grid gap-2 p-3">
        <Select value={triggerType} onValueChange={(v) => v && onChange(v, {})}>
          <SelectTrigger><SelectValue placeholder="Choose a trigger" /></SelectTrigger>
          <SelectContent>
            {TRIGGER_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {triggerType === 'keyword_match' && (
          <div className="grid gap-2">
            <Textarea
              value={((triggerConfig.keywords as string[]) ?? []).join('\n')}
              onChange={(e) => set({ keywords: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
              placeholder={'One keyword per line'}
              rows={2}
            />
            <div className="flex items-center justify-between">
              <Select value={String(triggerConfig.match_type ?? 'contains')} onValueChange={(v) => v && set({ match_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">Contains</SelectItem>
                  <SelectItem value="exact">Exact match</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={triggerConfig.case_sensitive === true} onCheckedChange={(v) => set({ case_sensitive: v })} />
                Case sensitive
              </label>
            </div>
          </div>
        )}
        {triggerType === 'tag_added' && (
          <Select value={String(triggerConfig.tag_id ?? '')} onValueChange={(v) => v && set({ tag_id: v })}>
            <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
            <SelectContent>
              {resources.tags.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {triggerType === 'time_based' && (
          <Input
            value={String(triggerConfig.schedule ?? '')}
            onChange={(e) => set({ schedule: e.target.value })}
            placeholder="Cron expression"
          />
        )}
        {triggerType === 'interactive_reply' && (
          <Textarea
            value={((triggerConfig.reply_ids as string[]) ?? []).join('\n')}
            onChange={(e) => set({ reply_ids: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
            placeholder="One reply id per line"
            rows={2}
          />
        )}
      </div>
    </div>
  );
}

export interface AutomationInitial {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  steps: BuilderStep[];
}

export function AutomationBuilder({
  workspaceId,
  automationId,
  initial,
}: {
  workspaceId: string;
  automationId?: string;
  initial?: AutomationInitial;
}) {
  const router = useRouter();
  const resources = useResources(workspaceId);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [triggerType, setTriggerType] = useState(initial?.trigger_type ?? 'new_message_received');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(initial?.trigger_config ?? {});
  const [isActive, setIsActive] = useState(initial?.is_active ?? false);
  const [steps, setSteps] = useState<UIStep[]>(() => withCids(initial?.steps ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setIssues([]);
    const payload = {
      workspace_id: workspaceId,
      name: name.trim(),
      description: description.trim() || null,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      is_active: isActive,
      steps: stripCids(steps),
    };
    const res = await fetch(automationId ? `/api/account/automations/${automationId}` : '/api/account/automations', {
      method: automationId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      if (Array.isArray(json.issues)) setIssues(json.issues);
      return;
    }
    router.push('/automations');
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/automations')} aria-label="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Automation name"
          className="h-8 max-w-xs font-medium"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          Active
        </label>
        <div className="flex-1" />
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button onClick={handleSave} disabled={saving || !name.trim()}>
          {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
          Save
        </Button>
      </div>

      {issues.length > 0 && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2">
          {issues.map((issue, i) => (
            <p key={i} className="text-xs text-destructive">{issue.path}: {issue.message}</p>
          ))}
        </div>
      )}

      <div className="grid gap-1.5 border-b border-border px-4 py-2">
        <Label htmlFor="automation-description" className="text-xs text-muted-foreground">Description (optional)</Label>
        <Input
          id="automation-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-8"
        />
      </div>

      <div
        className="flex-1 overflow-auto p-8"
        style={{ backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      >
        <div className="flex flex-col items-center gap-2">
          <TriggerCard
            triggerType={triggerType}
            triggerConfig={triggerConfig}
            onChange={(type, config) => {
              setTriggerType(type);
              setTriggerConfig(config);
            }}
            resources={resources}
          />
          <div className="h-4 w-px bg-border" />
          <StepList steps={steps} onChange={setSteps} resources={resources} />
        </div>
      </div>
    </div>
  );
}

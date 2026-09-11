'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { TemplateForm, type TemplateFormValues } from '@/components/templates/template-form';
import type { TemplateButton } from '@/types';
import { Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  category: string;
  language: string | null;
  header_type: string | null;
  header_content: string | null;
  header_media_url: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: TemplateButton[] | null;
  sample_values: { body?: string[]; header?: string[] } | null;
  status: string | null;
  rejection_reason: string | null;
  quality_score: string | null;
  submission_error: string | null;
}

const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED']);

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  APPROVED: 'default',
  PENDING: 'secondary',
  DRAFT: 'outline',
  REJECTED: 'destructive',
  PAUSED: 'outline',
  DISABLED: 'destructive',
  IN_APPEAL: 'secondary',
  PENDING_DELETION: 'outline',
};

function templateToFormValues(t: Template): TemplateFormValues {
  return {
    name: t.name,
    category: t.category === 'Utility' ? 'Utility' : 'Marketing',
    language: t.language ?? 'en_US',
    header_type: (t.header_type as TemplateFormValues['header_type']) ?? '',
    header_content: t.header_content ?? '',
    header_media_url: t.header_media_url ?? '',
    header_sample: t.sample_values?.header?.[0] ?? '',
    body_text: t.body_text,
    body_samples: t.sample_values?.body ?? [],
    footer_text: t.footer_text ?? '',
    buttons: t.buttons ?? [],
  };
}

function formValuesToPayload(values: TemplateFormValues, workspaceId: string) {
  return {
    workspace_id: workspaceId,
    name: values.name.trim(),
    category: values.category,
    language: values.language.trim() || 'en_US',
    header_type: values.header_type || undefined,
    header_content: values.header_type === 'text' ? values.header_content : undefined,
    header_media_url:
      values.header_type === 'image' || values.header_type === 'video' || values.header_type === 'document'
        ? values.header_media_url
        : undefined,
    body_text: values.body_text,
    footer_text: values.footer_text || undefined,
    buttons: values.buttons.length ? values.buttons : undefined,
    sample_values:
      values.body_samples.length || values.header_sample
        ? {
            body: values.body_samples.length ? values.body_samples : undefined,
            header: values.header_sample ? [values.header_sample] : undefined,
          }
        : undefined,
  };
}

export default function TemplatesPage() {
  const { workspaceId } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/templates?workspace_id=${workspaceId}&status=all`);
    if (res.ok) setTemplates((await res.json()).data);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleSync = async () => {
    if (!workspaceId) return;
    setSyncing(true);
    setSyncMessage(null);
    const res = await fetch('/api/account/templates/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    const json = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) {
      setSyncMessage(json.error ?? 'Sync failed');
      return;
    }
    setSyncMessage(`Synced: ${json.data.inserted} new, ${json.data.updated} updated`);
    load();
  };

  const handleCreate = async (values: TemplateFormValues) => {
    if (!workspaceId) return;
    setSubmitting(true);
    setFormError(null);
    const res = await fetch('/api/account/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formValuesToPayload(values, workspaceId)),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setFormError(json.error ?? 'Something went wrong');
      return;
    }
    setCreateOpen(false);
    load();
  };

  const handleEdit = async (values: TemplateFormValues) => {
    if (!workspaceId || !editing) return;
    setSubmitting(true);
    setFormError(null);
    const res = await fetch(`/api/account/templates/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formValuesToPayload(values, workspaceId)),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setFormError(json.error ?? 'Something went wrong');
      return;
    }
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!workspaceId) return;
    await fetch(`/api/account/templates/${id}?workspace_id=${workspaceId}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Templates</h2>
        <div className="flex items-center gap-2">
          {syncMessage && <span className="text-xs text-muted-foreground">{syncMessage}</span>}
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className="size-4" />
            {syncing ? 'Syncing...' : 'Sync from Meta'}
          </Button>
          <Dialog
            open={createOpen}
            onOpenChange={(next) => {
              setCreateOpen(next);
              if (!next) setFormError(null);
            }}
          >
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" />
                  New template
                </Button>
              }
            />
            <DialogContent className="border-border bg-card sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-foreground">New template</DialogTitle>
              </DialogHeader>
              <TemplateForm
                submitLabel="Submit for approval"
                submitting={submitting}
                error={formError}
                onSubmit={handleCreate}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading templates...</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No templates yet — create one, or sync existing templates already approved in Meta WhatsApp Manager.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                <TableCell className="text-muted-foreground">{t.category}</TableCell>
                <TableCell className="text-muted-foreground">{t.language}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={STATUS_VARIANT[t.status ?? ''] ?? 'outline'}>{t.status ?? 'UNKNOWN'}</Badge>
                    {t.status === 'REJECTED' && t.rejection_reason && (
                      <span className="text-xs text-destructive">{t.rejection_reason}</span>
                    )}
                    {t.submission_error && <span className="text-xs text-destructive">{t.submission_error}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{t.quality_score ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {t.status && EDITABLE_STATUSES.has(t.status) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setEditing(t);
                          setFormError(null);
                        }}
                        aria-label={`Edit ${t.name}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(t.id)}
                      aria-label={`Delete ${t.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) {
            setEditing(null);
            setFormError(null);
          }
        }}
      >
        <DialogContent className="border-border bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Edit {editing?.name}</DialogTitle>
          </DialogHeader>
          {editing && (
            <TemplateForm
              initial={templateToFormValues(editing)}
              isEdit
              submitLabel="Resubmit for approval"
              submitting={submitting}
              error={formError}
              onSubmit={handleEdit}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

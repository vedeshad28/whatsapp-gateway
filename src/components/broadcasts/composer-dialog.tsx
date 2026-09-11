'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import { Radio } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  language: string | null;
  body_text: string;
  body_variable_count: number;
  header_type: string | null;
  header_content: string | null;
  header_media_url: string | null;
}

interface Tag {
  id: string;
  name: string;
}

const ALL_CONTACTS_VALUE = '__all__';

export function ComposerDialog({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [audienceTagId, setAudienceTagId] = useState(ALL_CONTACTS_VALUE);
  const [useContactName, setUseContactName] = useState(false);
  const [nameVarIndex, setNameVarIndex] = useState(1);
  const [fixedValues, setFixedValues] = useState<Record<number, string>>({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [headerFilename, setHeaderFilename] = useState('');
  const [headerText, setHeaderText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const isMediaHeader =
    selectedTemplate?.header_type === 'image' ||
    selectedTemplate?.header_type === 'video' ||
    selectedTemplate?.header_type === 'document';
  const needsHeaderMedia = isMediaHeader && !selectedTemplate?.header_media_url;
  const headerTextVarCount =
    selectedTemplate?.header_type === 'text'
      ? extractVariableIndices(selectedTemplate.header_content ?? '').length
      : 0;

  useEffect(() => {
    if (!open) return;
    // Fetch-on-dialog-open, not derived-state-from-props — the rule
    // below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingOptions(true);
    Promise.all([
      fetch(`/api/account/templates?workspace_id=${workspaceId}`).then((r) => r.json()),
      fetch(`/api/account/tags?workspace_id=${workspaceId}`).then((r) => r.json()),
    ]).then(([tJson, gJson]) => {
      setTemplates(tJson.data ?? []);
      setTags(gJson.data ?? []);
      setLoadingOptions(false);
    });
  }, [open, workspaceId]);

  const reset = () => {
    setName('');
    setTemplateId('');
    setAudienceTagId(ALL_CONTACTS_VALUE);
    setUseContactName(false);
    setNameVarIndex(1);
    setFixedValues({});
    setHeaderMediaUrl('');
    setHeaderFilename('');
    setHeaderText('');
    setError(null);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);

    const bodyParams: Record<string, string> = {};
    if (selectedTemplate) {
      for (let i = 1; i <= selectedTemplate.body_variable_count; i++) {
        if (useContactName && i === nameVarIndex) continue;
        if (fixedValues[i]) bodyParams[String(i)] = fixedValues[i];
      }
    }

    const res = await fetch('/api/account/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name,
        template_id: templateId,
        audience_tag_id: audienceTagId === ALL_CONTACTS_VALUE ? undefined : audienceTagId,
        body_params: Object.keys(bodyParams).length ? bodyParams : undefined,
        use_contact_name_var: useContactName ? nameVarIndex : undefined,
        header_media_url: needsHeaderMedia ? headerMediaUrl : undefined,
        header_filename: needsHeaderMedia && selectedTemplate?.header_type === 'document' ? headerFilename : undefined,
        header_text: headerTextVarCount > 0 ? headerText : undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSending(false);

    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      return;
    }

    setOpen(false);
    reset();
    router.push(`/broadcasts/${json.data.id}`);
  };

  const audienceItems = {
    [ALL_CONTACTS_VALUE]: 'All contacts',
    ...Object.fromEntries(tags.map((t) => [t.id, t.name])),
  };
  const templateItems = Object.fromEntries(templates.map((t) => [t.id, t.name]));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Radio className="size-4" />
            New broadcast
          </Button>
        }
      />
      <DialogContent className="border-border bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">New broadcast</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            WhatsApp only allows business-initiated messages through an approved template.
          </DialogDescription>
        </DialogHeader>

        {loadingOptions ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No approved templates yet — submit and get one approved via Meta (Settings → WhatsApp)
            before you can send a broadcast.
          </p>
        ) : (
          <form onSubmit={handleSend} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="broadcast-name">Broadcast name</Label>
              <Input id="broadcast-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Template</Label>
              <Select items={templateItems} value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.language ?? 'default'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {selectedTemplate.body_text}
                </p>
              )}
            </div>

            {isMediaHeader && (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  This template has a {selectedTemplate?.header_type} header
                </p>
                {needsHeaderMedia ? (
                  <>
                    <Label htmlFor="header-media-url" className="text-xs">
                      Header media URL (same file sent to everyone in this broadcast)
                    </Label>
                    <Input
                      id="header-media-url"
                      type="url"
                      required
                      placeholder="https://..."
                      value={headerMediaUrl}
                      onChange={(e) => setHeaderMediaUrl(e.target.value)}
                    />
                    {selectedTemplate?.header_type === 'document' && (
                      <Input
                        placeholder="Filename shown to recipients (optional)"
                        value={headerFilename}
                        onChange={(e) => setHeaderFilename(e.target.value)}
                      />
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Uses the template&apos;s own media — nothing to fill in.</p>
                )}
              </div>
            )}

            {headerTextVarCount > 0 && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="header-text" className="text-xs">
                  Header text value ({'{{1}}'})
                </Label>
                <Input id="header-text" required value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Audience</Label>
              <Select items={audienceItems} value={audienceTagId} onValueChange={(v) => v && setAudienceTagId(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CONTACTS_VALUE}>All contacts</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedTemplate && selectedTemplate.body_variable_count > 0 && (
              <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">Template variables</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={useContactName} onCheckedChange={(v) => setUseContactName(!!v)} />
                  Fill one variable with each contact&apos;s name
                </label>
                {useContactName && selectedTemplate.body_variable_count > 1 && (
                  <div className="flex items-center gap-2 pl-6">
                    <Label htmlFor="name-var-index" className="text-xs">
                      Which variable? {'{{'}
                    </Label>
                    <Input
                      id="name-var-index"
                      type="number"
                      min={1}
                      max={selectedTemplate.body_variable_count}
                      value={nameVarIndex}
                      onChange={(e) => setNameVarIndex(Number(e.target.value) || 1)}
                      className="h-7 w-16"
                    />
                    <span className="text-xs text-muted-foreground">{'}}'}</span>
                  </div>
                )}
                {Array.from({ length: selectedTemplate.body_variable_count }, (_, i) => i + 1)
                  .filter((i) => !(useContactName && i === nameVarIndex))
                  .map((i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <Label htmlFor={`var-${i}`} className="text-xs">
                        {'{{' + i + '}}'} value
                      </Label>
                      <Input
                        id={`var-${i}`}
                        value={fixedValues[i] ?? ''}
                        onChange={(e) => setFixedValues((prev) => ({ ...prev, [i]: e.target.value }))}
                      />
                    </div>
                  ))}
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={sending || !templateId}>
                {sending ? 'Launching...' : 'Send broadcast'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

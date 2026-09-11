'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import type { TemplateButton } from '@/types';
import { Plus, Trash2 } from 'lucide-react';

export interface TemplateFormValues {
  name: string;
  category: 'Marketing' | 'Utility';
  language: string;
  header_type: '' | 'text' | 'image' | 'video' | 'document';
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

export const EMPTY_TEMPLATE_FORM: TemplateFormValues = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_type: '',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
};

const CATEGORY_ITEMS = { Marketing: 'Marketing', Utility: 'Utility' };
const HEADER_TYPE_ITEMS = { none: 'None', text: 'Text', image: 'Image', video: 'Video', document: 'Document' };
const BUTTON_TYPE_ITEMS = {
  QUICK_REPLY: 'Quick reply',
  URL: 'Website URL',
  PHONE_NUMBER: 'Call phone number',
  COPY_CODE: 'Copy offer code',
};

interface TemplateFormProps {
  initial?: TemplateFormValues;
  /** Editing an already-submitted template — name/language become read-only (Meta doesn't allow renaming via edit). */
  isEdit?: boolean;
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: TemplateFormValues) => void;
}

export function TemplateForm({ initial, isEdit, submitLabel, submitting, error, onSubmit }: TemplateFormProps) {
  const [values, setValues] = useState<TemplateFormValues>(initial ?? EMPTY_TEMPLATE_FORM);

  const bodyVarCount = useMemo(() => extractVariableIndices(values.body_text).length, [values.body_text]);
  const headerVarCount = useMemo(
    () => (values.header_type === 'text' ? extractVariableIndices(values.header_content).length : 0),
    [values.header_type, values.header_content]
  );

  const setBodySample = (index: number, value: string) => {
    setValues((prev) => {
      const samples = [...prev.body_samples];
      samples[index] = value;
      return { ...prev, body_samples: samples };
    });
  };

  const addButton = () => {
    setValues((prev) => ({
      ...prev,
      buttons: [...prev.buttons, { type: 'QUICK_REPLY', text: '' } as TemplateButton],
    }));
  };
  const removeButton = (index: number) => {
    setValues((prev) => ({ ...prev, buttons: prev.buttons.filter((_, i) => i !== index) }));
  };
  const updateButton = (index: number, next: TemplateButton) => {
    setValues((prev) => ({ ...prev, buttons: prev.buttons.map((b, i) => (i === index ? next : b)) }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="tpl-name">Name (lowercase_with_underscores)</Label>
          <Input
            id="tpl-name"
            required
            disabled={isEdit}
            pattern="[a-z0-9_]{1,512}"
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="tpl-language">Language code</Label>
          <Input
            id="tpl-language"
            required
            disabled={isEdit}
            placeholder="en_US"
            value={values.language}
            onChange={(e) => setValues((v) => ({ ...v, language: e.target.value }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Category</Label>
        <Select
          items={CATEGORY_ITEMS}
          value={values.category}
          onValueChange={(v) => v && setValues((s) => ({ ...s, category: v as 'Marketing' | 'Utility' }))}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Marketing">Marketing</SelectItem>
            <SelectItem value="Utility">Utility</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Authentication templates aren&apos;t supported here — create those directly in Meta WhatsApp Manager, then
          use Sync.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border p-3">
        <Label>Header (optional)</Label>
        <Select
          items={HEADER_TYPE_ITEMS}
          value={values.header_type || 'none'}
          onValueChange={(v) =>
            setValues((s) => ({ ...s, header_type: (v === 'none' ? '' : v) as TemplateFormValues['header_type'] }))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="video">Video</SelectItem>
            <SelectItem value="document">Document</SelectItem>
          </SelectContent>
        </Select>

        {values.header_type === 'text' && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="tpl-header-content" className="text-xs">
              Header text (optionally one {'{{1}}'} variable)
            </Label>
            <Input
              id="tpl-header-content"
              value={values.header_content}
              onChange={(e) => setValues((v) => ({ ...v, header_content: e.target.value }))}
            />
            {headerVarCount > 0 && (
              <Input
                placeholder="Sample value for header {{1}}"
                value={values.header_sample}
                onChange={(e) => setValues((v) => ({ ...v, header_sample: e.target.value }))}
              />
            )}
          </div>
        )}
        {(values.header_type === 'image' || values.header_type === 'video' || values.header_type === 'document') && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="tpl-header-media" className="text-xs">
              Public media URL
            </Label>
            <Input
              id="tpl-header-media"
              type="url"
              placeholder="https://..."
              value={values.header_media_url}
              onChange={(e) => setValues((v) => ({ ...v, header_media_url: e.target.value }))}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tpl-body">Body text</Label>
        <Textarea
          id="tpl-body"
          required
          rows={4}
          placeholder="Hi {{1}}, your order {{2}} has shipped!"
          value={values.body_text}
          onChange={(e) => setValues((v) => ({ ...v, body_text: e.target.value }))}
        />
        {bodyVarCount > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground">Sample values (required for Meta review):</p>
            {Array.from({ length: bodyVarCount }, (_, i) => i).map((i) => (
              <Input
                key={i}
                placeholder={`Sample value for {{${i + 1}}}`}
                value={values.body_samples[i] ?? ''}
                onChange={(e) => setBodySample(i, e.target.value)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tpl-footer">Footer (optional)</Label>
        <Input
          id="tpl-footer"
          maxLength={60}
          value={values.footer_text}
          onChange={(e) => setValues((v) => ({ ...v, footer_text: e.target.value }))}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <Label>Buttons (optional)</Label>
          <Button type="button" size="sm" variant="outline" onClick={addButton}>
            <Plus className="size-3.5" />
            Add button
          </Button>
        </div>
        {values.buttons.map((button, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md bg-muted/40 p-2">
            <div className="flex flex-1 flex-col gap-2">
              <Select
                items={BUTTON_TYPE_ITEMS}
                value={button.type}
                onValueChange={(v) => {
                  if (!v) return;
                  const type = v as TemplateButton['type'];
                  const base = { text: button.text };
                  const next: TemplateButton =
                    type === 'QUICK_REPLY'
                      ? { type, ...base }
                      : type === 'URL'
                        ? { type, ...base, url: '' }
                        : type === 'PHONE_NUMBER'
                          ? { type, ...base, phone_number: '' }
                          : { type, ...base, example: '' };
                  updateButton(i, next);
                }}
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BUTTON_TYPE_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Button text"
                value={button.text}
                onChange={(e) => updateButton(i, { ...button, text: e.target.value })}
              />
              {button.type === 'URL' && (
                <Input
                  placeholder="https://example.com/{{1}}"
                  value={button.url}
                  onChange={(e) => updateButton(i, { ...button, url: e.target.value })}
                />
              )}
              {button.type === 'PHONE_NUMBER' && (
                <Input
                  placeholder="+14155551234"
                  value={button.phone_number}
                  onChange={(e) => updateButton(i, { ...button, phone_number: e.target.value })}
                />
              )}
              {button.type === 'COPY_CODE' && (
                <Input
                  placeholder="Example code, e.g. SAVE20"
                  value={button.example}
                  onChange={(e) => updateButton(i, { ...button, example: e.target.value })}
                />
              )}
            </div>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeButton(i)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button type="submit" disabled={submitting} className="w-fit disabled:opacity-50">
        {submitting ? 'Saving...' : submitLabel}
      </Button>
    </form>
  );
}

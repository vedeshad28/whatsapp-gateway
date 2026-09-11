'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tag as TagIcon, X, Plus } from 'lucide-react';

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface TagPickerProps {
  workspaceId: string;
  contactId: string;
  contactTags: Tag[];
  allTags: Tag[];
  onChange: () => void;
  /** New tags created here get added to the workspace's shared tag list too. */
  onTagCreated: (tag: Tag) => void;
}

export function TagPicker({
  workspaceId,
  contactId,
  contactTags,
  allTags,
  onChange,
  onTagCreated,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const contactTagIds = new Set(contactTags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !contactTagIds.has(t.id));

  const addTag = async (tagId: string) => {
    await fetch(`/api/account/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, tag_id: tagId }),
    });
    onChange();
  };

  const removeTag = async (tagId: string) => {
    await fetch(
      `/api/account/contacts/${contactId}/tags?workspace_id=${workspaceId}&tag_id=${tagId}`,
      { method: 'DELETE' }
    );
    onChange();
  };

  const createAndAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const res = await fetch('/api/account/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, name }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.data) {
      onTagCreated(json.data);
      await addTag(json.data.id);
    }
    setNewTagName('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {contactTags.map((tag) => (
        <Badge key={tag.id} variant="secondary" className="gap-1">
          {tag.name}
          <button
            type="button"
            onClick={() => removeTag(tag.id)}
            aria-label={`Remove ${tag.name} tag`}
            className="hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Add tag"
              className="flex size-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              <Plus className="size-3" />
            </button>
          }
        />
        <PopoverContent className="w-56 border-border bg-card p-2">
          <div className="flex items-center gap-1.5 border-b border-border pb-2 text-xs font-medium text-muted-foreground">
            <TagIcon className="size-3.5" />
            Tags
          </div>
          <div className="flex flex-col gap-1 py-2">
            {availableTags.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">No more tags to add.</p>
            ) : (
              availableTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    addTag(tag.id);
                    setOpen(false);
                  }}
                  className="rounded-md px-2 py-1 text-left text-sm text-foreground hover:bg-muted"
                >
                  {tag.name}
                </button>
              ))
            )}
          </div>
          <div className="flex items-center gap-1 border-t border-border pt-2">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createAndAddTag();
                }
              }}
              placeholder="New tag..."
              className="h-7 text-sm"
            />
            <Button size="icon-sm" type="button" onClick={createAndAddTag}>
              <Plus className="size-3.5" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

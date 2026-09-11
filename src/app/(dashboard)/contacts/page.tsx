'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { TagPicker, type Tag } from '@/components/contacts/tag-picker';
import { Plus, Trash2, MessageSquare } from 'lucide-react';

interface Contact {
  id: string;
  name: string | null;
  phone: string;
  created_at: string;
  tags: Tag[];
}

const ALL_TAGS_VALUE = '__all__';

export default function ContactsPage() {
  const { workspaceId } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState(ALL_TAGS_VALUE);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const contactsUrl =
      `/api/account/contacts?workspace_id=${workspaceId}` +
      (tagFilter !== ALL_TAGS_VALUE ? `&tag_id=${tagFilter}` : '');
    const [cRes, tRes] = await Promise.all([
      fetch(contactsUrl),
      fetch(`/api/account/tags?workspace_id=${workspaceId}`),
    ]);
    if (cRes.ok) setContacts((await cRes.json()).data);
    if (tRes.ok) setAllTags((await tRes.json()).data);
    setLoading(false);
  }, [workspaceId, tagFilter]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/account/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, phone, name: name || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      return;
    }
    setPhone('');
    setName('');
    setOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!workspaceId) return;
    await fetch(`/api/account/contacts/${id}?workspace_id=${workspaceId}`, { method: 'DELETE' });
    load();
  };

  const tagFilterItems = { [ALL_TAGS_VALUE]: 'All contacts', ...Object.fromEntries(allTags.map((t) => [t.id, t.name])) };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Contacts</h2>
        <div className="flex items-center gap-2">
          {allTags.length > 0 && (
            <Select items={tagFilterItems} value={tagFilter} onValueChange={(v) => v && setTagFilter(v)}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TAGS_VALUE}>All contacts</SelectItem>
                {allTags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) {
                setError(null);
                setPhone('');
                setName('');
              }
            }}
          >
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" />
                  Add contact
                </Button>
              }
            />
            <DialogContent className="border-border bg-card">
              <DialogHeader>
                <DialogTitle className="text-foreground">Add a contact</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="contact-phone">Phone (E.164, e.g. +14155551234)</Label>
                  <Input id="contact-phone" required value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="contact-name">Name (optional)</Label>
                  <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button type="submit">Add contact</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading contacts...</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tagFilter !== ALL_TAGS_VALUE
            ? 'No contacts have this tag.'
            : 'No contacts yet — connect a WhatsApp number (Settings → WhatsApp) and add your first contact, or one will appear automatically the next time a customer messages you.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-foreground">{c.name ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{c.phone}</TableCell>
                <TableCell>
                  {workspaceId && (
                    <TagPicker
                      workspaceId={workspaceId}
                      contactId={c.id}
                      contactTags={c.tags}
                      allTags={allTags}
                      onChange={load}
                      onTagCreated={(tag) => setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      render={<Link href={`/inbox?contact=${c.id}`} />}
                      aria-label={`Message ${c.name ?? c.phone}`}
                    >
                      <MessageSquare className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(c.id)}
                      aria-label={`Delete ${c.name ?? c.phone}`}
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
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Plus, MoreVertical, Copy, ScrollText, Trash2 } from 'lucide-react';

interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
}

const TRIGGER_LABELS: Record<string, string> = {
  new_message_received: 'New message',
  first_inbound_message: "Contact's first message",
  keyword_match: 'Keyword match',
  new_contact_created: 'New contact',
  conversation_assigned: 'Conversation assigned',
  tag_added: 'Tag added',
  time_based: 'Time-based',
  interactive_reply: 'Button/list reply',
};

export default function AutomationsPage() {
  const router = useRouter();
  const { workspaceId } = useAuth();
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRow | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/automations?workspace_id=${workspaceId}`);
    if (res.ok) setAutomations((await res.json()).data);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggleActive = async (automation: AutomationRow) => {
    if (!workspaceId) return;
    const nextActive = !automation.is_active;
    setAutomations((prev) => prev.map((a) => (a.id === automation.id ? { ...a, is_active: nextActive } : a)));
    const res = await fetch(`/api/account/automations/${automation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, is_active: nextActive }),
    });
    if (!res.ok) {
      setAutomations((prev) => prev.map((a) => (a.id === automation.id ? { ...a, is_active: !nextActive } : a)));
    }
  };

  const handleDuplicate = async (automation: AutomationRow) => {
    if (!workspaceId) return;
    await fetch(`/api/account/automations/${automation.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    load();
  };

  const handleDelete = async () => {
    if (!workspaceId || !deleteTarget) return;
    await fetch(`/api/account/automations/${deleteTarget.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    setDeleteTarget(null);
    load();
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Automations</h2>
        <Button onClick={() => router.push('/automations/new')}>
          <Plus className="size-4" />
          New automation
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading automations...</p>
      ) : automations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No automations yet — create a rule that reacts to a trigger (a keyword, a new contact, a tapped button) with a chain of actions.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {automations.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link href={`/automations/${a.id}/edit`} className="font-medium text-foreground hover:underline">
                    {a.name}
                  </Link>
                  {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                </TableCell>
                <TableCell className="text-muted-foreground">{TRIGGER_LABELS[a.trigger_type] ?? a.trigger_type}</TableCell>
                <TableCell className="text-muted-foreground">{a.execution_count}</TableCell>
                <TableCell className="text-muted-foreground">
                  {a.last_executed_at ? new Date(a.last_executed_at).toLocaleString() : '—'}
                </TableCell>
                <TableCell>
                  <Switch checked={a.is_active} onCheckedChange={() => toggleActive(a)} />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex size-7 items-center justify-center rounded-md hover:bg-muted"
                      aria-label="More actions"
                    >
                      <MoreVertical className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => router.push(`/automations/${a.id}/edit`)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push(`/automations/${a.id}/logs`)}>
                        <ScrollText className="size-3.5" /> Logs
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(a)}>
                        <Copy className="size-3.5" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(a)}>
                        <Trash2 className="size-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}>
        <DialogContent className="border-border bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete &quot;{deleteTarget?.name}&quot;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This can&apos;t be undone — its logs and pending runs are deleted too.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

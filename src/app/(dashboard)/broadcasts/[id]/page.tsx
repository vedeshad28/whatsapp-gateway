'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Recipient {
  id: string;
  contact: { id: string; name: string | null; phone: string };
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  error_message: string | null;
}

interface BroadcastDetail {
  id: string;
  name: string;
  template_name: string;
  audience_tag: string | null;
  status: 'sending' | 'completed' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  recipients: Recipient[];
}

const STATUS_VARIANT: Record<Recipient['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  sent: 'outline',
  delivered: 'outline',
  read: 'default',
  failed: 'destructive',
};

const POLL_INTERVAL_MS = 3000;

export default function BroadcastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { workspaceId } = useAuth();
  const [broadcast, setBroadcast] = useState<BroadcastDetail | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/broadcasts/${id}?workspace_id=${workspaceId}`);
    if (res.ok) setBroadcast((await res.json()).data);
  }, [workspaceId, id]);

  useEffect(() => {
    // Mount fetch, not derived-state-from-props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (broadcast?.status !== 'sending') return;
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [broadcast?.status, load]);

  if (!broadcast) {
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{broadcast.name}</h2>
          <p className="text-sm text-muted-foreground">
            {broadcast.template_name} · {broadcast.audience_tag ?? 'All contacts'}
          </p>
        </div>
        <div className="text-right">
          <Badge variant={broadcast.status === 'failed' ? 'destructive' : broadcast.status === 'sending' ? 'secondary' : 'default'}>
            {broadcast.status}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">
            {broadcast.sent_count + broadcast.failed_count}/{broadcast.total_recipients} processed
          </p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contact</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {broadcast.recipients.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium text-foreground">{r.contact.name ?? '—'}</TableCell>
              <TableCell className="text-muted-foreground">{r.contact.phone}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
              </TableCell>
              <TableCell className="text-xs text-destructive">{r.error_message ?? ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { ComposerDialog } from '@/components/broadcasts/composer-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface BroadcastSummary {
  id: string;
  name: string;
  template_name: string;
  audience_tag: string | null;
  status: 'sending' | 'completed' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

const STATUS_VARIANT: Record<BroadcastSummary['status'], 'default' | 'secondary' | 'destructive'> = {
  sending: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

export default function BroadcastsPage() {
  const { workspaceId } = useAuth();
  const [broadcasts, setBroadcasts] = useState<BroadcastSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/broadcasts?workspace_id=${workspaceId}`);
    if (res.ok) setBroadcasts((await res.json()).data);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Broadcasts</h2>
        {workspaceId && <ComposerDialog workspaceId={workspaceId} />}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading broadcasts...</p>
      ) : broadcasts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No broadcasts yet — send the same template message to many contacts at once.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {broadcasts.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <Link href={`/broadcasts/${b.id}`} className="font-medium text-foreground hover:underline">
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{b.template_name}</TableCell>
                <TableCell className="text-muted-foreground">{b.audience_tag ?? 'All contacts'}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {b.sent_count + b.failed_count}/{b.total_recipients}
                  {b.failed_count > 0 && <span className="text-destructive"> ({b.failed_count} failed)</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

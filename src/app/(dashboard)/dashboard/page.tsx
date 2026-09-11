'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { MetricCard } from '@/components/dashboard/metric-card';
import { formatCurrency } from '@/lib/currency';
import { Users, MessageSquare, GitBranch, Trophy } from 'lucide-react';

interface Summary {
  connected: boolean;
  contacts: number;
  conversations: number;
  open_deals: number;
  open_deals_value: number;
  won_deals_value: number;
}

export default function DashboardPage() {
  const { user, workspace, workspaceId, defaultCurrency } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/dashboard-summary?workspace_id=${workspaceId}`);
    if (res.ok) {
      const json = await res.json();
      setSummary(json.data);
    }
  }, [workspaceId]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-foreground">
        Welcome{user?.name ? `, ${user.name}` : ''}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{workspace?.name}</p>

      {summary && !summary.connected && (
        <p className="mt-4 text-sm text-muted-foreground">
          Connect a WhatsApp number (Settings → WhatsApp) to start tracking activity here.
        </p>
      )}

      {summary && (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Contacts" value={String(summary.contacts)} icon={Users} />
          <MetricCard label="Conversations" value={String(summary.conversations)} icon={MessageSquare} />
          <MetricCard
            label="Open deals"
            value={`${summary.open_deals} · ${formatCurrency(summary.open_deals_value, defaultCurrency)}`}
            icon={GitBranch}
          />
          <MetricCard
            label="Won (all time)"
            value={formatCurrency(summary.won_deals_value, defaultCurrency)}
            icon={Trophy}
          />
        </div>
      )}
    </div>
  );
}

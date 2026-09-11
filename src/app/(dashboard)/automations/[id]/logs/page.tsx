'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';

interface StepExecution {
  stepId: string;
  stepType: string;
  status: 'ok' | 'skipped' | 'error';
  detail?: string;
}

interface LogRow {
  id: string;
  contact_name: string | null;
  contact_phone: string | null;
  trigger_event: string;
  status: string;
  error_message: string | null;
  steps_executed: StepExecution[];
  created_at: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  success: 'default',
  partial: 'secondary',
  failed: 'destructive',
};

export default function AutomationLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { workspaceId } = useAuth();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/account/automations/${id}/logs?workspace_id=${workspaceId}`)
      .then((r) => r.json())
      .then((json) => {
        setLogs(json.data ?? []);
        setLoading(false);
      });
  }, [workspaceId, id]);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/automations')} aria-label="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="text-lg font-semibold text-foreground">Execution logs</h2>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading logs...</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {logs.map((log) => (
            <div key={log.id} className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setOpenId(openId === log.id ? null : log.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                {openId === log.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                <Badge variant={STATUS_VARIANT[log.status] ?? 'secondary'}>{log.status}</Badge>
                <span className="text-sm text-foreground">{log.contact_name ?? log.contact_phone ?? 'Unknown contact'}</span>
                <span className="text-xs text-muted-foreground">{log.trigger_event}</span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
              </button>
              {openId === log.id && (
                <div className="border-t border-border px-3 py-2">
                  {log.error_message && <p className="mb-2 text-xs text-destructive">{log.error_message}</p>}
                  <div className="flex flex-col gap-1">
                    {log.steps_executed.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant={step.status === 'error' ? 'destructive' : 'outline'} className="w-16 justify-center">
                          {step.status}
                        </Badge>
                        <span className="text-foreground">{step.stepType}</span>
                        {step.detail && <span className="text-muted-foreground">— {step.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

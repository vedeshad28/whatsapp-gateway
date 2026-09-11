'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/currency';
import { Plus, Trash2 } from 'lucide-react';

interface Stage {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

interface Deal {
  id: string;
  stage_id: string;
  title: string;
  value: number;
  currency: string;
  status: 'open' | 'won' | 'lost';
  contact: { id: string; name: string | null; phone: string } | null;
}

export default function PipelinesPage() {
  const { workspaceId, defaultCurrency, canSendMessages } = useAuth();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const pRes = await fetch(`/api/account/pipelines?workspace_id=${workspaceId}`);
    if (!pRes.ok) {
      setLoading(false);
      return;
    }
    const pJson = await pRes.json();
    setPipeline(pJson.data);

    if (pJson.data) {
      const dRes = await fetch(
        `/api/account/deals?workspace_id=${workspaceId}&pipeline_id=${pJson.data.id}`
      );
      if (dRes.ok) {
        const dJson = await dRes.json();
        setDeals(dJson.data);
      }
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!workspaceId || !pipeline) return;

    const res = await fetch('/api/account/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        pipeline_id: pipeline.id,
        stage_id: stageId || pipeline.stages[0]?.id,
        title,
        value: value ? Number(value) : 0,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      return;
    }
    setTitle('');
    setValue('');
    setOpen(false);
    load();
  };

  const moveDeal = async (dealId: string, newStageId: string) => {
    if (!workspaceId) return;
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)));
    await fetch(`/api/account/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, stage_id: newStageId }),
    });
  };

  const deleteDeal = async (dealId: string) => {
    if (!workspaceId) return;
    await fetch(`/api/account/deals/${dealId}?workspace_id=${workspaceId}`, { method: 'DELETE' });
    load();
  };

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading pipeline...</p>;
  }

  if (!pipeline) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Connect a WhatsApp number first (Settings → WhatsApp) to start tracking deals.
      </p>
    );
  }

  // Value→label map for the stage <Select>s below — base-ui's
  // SelectValue shows the raw `value` unless the Select.Root gets an
  // `items` map (or SelectValue gets a render-children function), so
  // without this a stage select would display the stage's UUID
  // instead of its name.
  const stageItems = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.name]));

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{pipeline.name}</h2>
        {canSendMessages && (
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) {
                setError(null);
                setTitle('');
                setValue('');
              }
            }}
          >
            <DialogTrigger
              render={
                <Button>
                  <Plus className="size-4" />
                  Add deal
                </Button>
              }
            />
            <DialogContent className="border-border bg-card">
              <DialogHeader>
                <DialogTitle className="text-foreground">Add a deal</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="deal-title">Title</Label>
                  <Input id="deal-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="deal-value">Value ({defaultCurrency})</Label>
                  <Input
                    id="deal-value"
                    type="number"
                    min="0"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Stage</Label>
                  <Select
                    items={stageItems}
                    value={stageId || pipeline.stages[0]?.id}
                    onValueChange={(v) => v && setStageId(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pipeline.stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit">Add deal</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto">
        {pipeline.stages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage_id === stage.id);
          const total = stageDeals.reduce((sum, d) => sum + d.value, 0);
          return (
            <div key={stage.id} className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: stage.color ?? undefined }}
                  />
                  <span className="text-sm font-medium text-foreground">{stage.name}</span>
                  <span className="text-xs text-muted-foreground">({stageDeals.length})</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(total, defaultCurrency)}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {stageDeals.map((deal) => (
                  <div key={deal.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{deal.title}</p>
                      {canSendMessages && (
                        <button
                          type="button"
                          onClick={() => deleteDeal(deal.id)}
                          aria-label={`Delete ${deal.title}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCurrency(deal.value, deal.currency)}
                    </p>
                    {deal.contact && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {deal.contact.name ?? deal.contact.phone}
                      </p>
                    )}
                    {canSendMessages && (
                      <Select
                        items={stageItems}
                        value={deal.stage_id}
                        onValueChange={(v) => v && moveDeal(deal.id, v)}
                      >
                        <SelectTrigger size="sm" className="mt-2 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pipeline.stages.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

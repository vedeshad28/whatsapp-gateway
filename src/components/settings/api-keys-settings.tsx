'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { API_SCOPES, SCOPE_DESCRIPTIONS, type ApiScope } from '@/lib/api-keys/scopes';
import { KeyRound, X } from 'lucide-react';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  revoked_at: string | null;
}

export function ApiKeysSettings() {
  const { workspaceId, canEditSettings } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/api-keys?workspace_id=${workspaceId}`);
    if (res.ok) {
      const json = await res.json();
      setKeys(json.data.filter((k: ApiKeyRow) => !k.revoked_at));
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggleScope = (scope: ApiScope) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!workspaceId) return;

    const res = await fetch('/api/account/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, name, scopes }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      return;
    }
    setCreatedKey(json.data.key);
    load();
  };

  const revoke = async (keyId: string) => {
    if (!workspaceId) return;
    await fetch('/api/account/api-keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, key_id: keyId }),
    });
    load();
  };

  if (!canEditSettings) {
    return (
      <p className="text-xs text-muted-foreground">
        Only owners and admins can manage API keys.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading API keys...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">API keys</h3>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setName('');
              setScopes([]);
              setCreatedKey(null);
              setError(null);
            }
          }}
        >
          <DialogTrigger
            render={
              <Button>
                <KeyRound className="size-4" />
                New key
              </Button>
            }
          />
          <DialogContent className="border-border bg-card">
            <DialogHeader>
              <DialogTitle className="text-foreground">Create API key</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                The key is shown once — copy it now, it can&apos;t be retrieved again.
              </DialogDescription>
            </DialogHeader>

            {createdKey ? (
              <div className="flex flex-col gap-3">
                <Input readOnly value={createdKey} onFocus={(e) => e.currentTarget.select()} />
                <DialogFooter>
                  <Button onClick={() => setOpen(false)}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={createKey} className="flex flex-col gap-4">
                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="key-name">Name</Label>
                  <Input
                    id="key-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. salon-saas production"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Scopes</Label>
                  {API_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={scopes.includes(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                      />
                      <span>
                        <span className="font-mono text-foreground">{scope}</span>
                        <span className="block text-xs text-muted-foreground">
                          {SCOPE_DESCRIPTIONS[scope]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <DialogFooter>
                  <Button type="submit">Create key</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => (
            <TableRow key={key.id}>
              <TableCell className="font-medium text-foreground">{key.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {key.key_prefix}…
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {key.scopes.join(', ') || '—'}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon-sm" onClick={() => revoke(key.id)} aria-label={`Revoke ${key.name}`}>
                  <X className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

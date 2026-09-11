'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import type { WorkspaceRole } from '@/lib/auth/roles';
import { UserPlus } from 'lucide-react';

interface InviteMemberDialogProps {
  workspaceId: string;
  onInvited: () => void;
}

const INVITABLE_ROLES: WorkspaceRole[] = ['admin', 'agent', 'viewer'];
// Value→label map — see the identical comment in members-tab.tsx.
const ROLE_ITEMS = Object.fromEntries(
  INVITABLE_ROLES.map((r) => [r, r.charAt(0).toUpperCase() + r.slice(1)])
);

export function InviteMemberDialog({ workspaceId, onInvited }: InviteMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('agent');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setEmail('');
    setRole('agent');
    setLink(null);
    setError(null);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/account/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, email, role }),
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      return;
    }

    setLink(`${window.location.origin}${json.data.redeem_path}`);
    onInvited();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <UserPlus className="size-4" />
            Invite member
          </Button>
        }
      />
      <DialogContent className="border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-foreground">Invite a member</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Email delivery isn&apos;t configured on this instance — you&apos;ll get a link to
            share manually once the invite is created.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Share this link with {email}:</p>
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Role</Label>
              <Select items={ROLE_ITEMS} value={role} onValueChange={(v) => setRole(v as WorkspaceRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating invite...' : 'Create invite'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

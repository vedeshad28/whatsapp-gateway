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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog';
import { ROLE_META } from '@/components/settings/role-meta';
import type { WorkspaceRole } from '@/lib/auth/roles';
import { X } from 'lucide-react';

interface Member {
  user_id: string;
  name: string | null;
  email: string | null;
  role: WorkspaceRole;
  joined_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  expired: boolean;
}

const ASSIGNABLE_ROLES: WorkspaceRole[] = ['admin', 'agent', 'viewer'];
// Value→label map so the <Select> below shows "Admin" instead of the
// raw "admin" value — base-ui's SelectValue needs an explicit `items`
// map (or a render-children function) to resolve a display label.
const ROLE_ITEMS = Object.fromEntries(
  ASSIGNABLE_ROLES.map((r) => [r, r.charAt(0).toUpperCase() + r.slice(1)])
);

export function MembersTab() {
  const { workspaceId, user, canManageMembers, isOwner } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const [membersRes, invitesRes] = await Promise.all([
      fetch(`/api/account/members?workspace_id=${workspaceId}`),
      canManageMembers
        ? fetch(`/api/account/invitations?workspace_id=${workspaceId}`)
        : Promise.resolve(null),
    ]);
    if (membersRes.ok) {
      const json = await membersRes.json();
      setMembers(json.data);
    }
    if (invitesRes?.ok) {
      const json = await invitesRes.json();
      setInvitations(json.data);
    }
    setLoading(false);
  }, [workspaceId, canManageMembers]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const changeRole = async (userId: string, role: WorkspaceRole) => {
    if (!workspaceId) return;
    await fetch('/api/account/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, user_id: userId, role }),
    });
    load();
  };

  const removeMember = async (userId: string) => {
    if (!workspaceId) return;
    await fetch('/api/account/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, user_id: userId }),
    });
    load();
  };

  const revokeInvitation = async (invitationId: string) => {
    if (!workspaceId) return;
    await fetch('/api/account/invitations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, invitation_id: invitationId }),
    });
    load();
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading members...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Members</h3>
        {canManageMembers && workspaceId && (
          <InviteMemberDialog workspaceId={workspaceId} onInvited={load} />
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            {canManageMembers && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const meta = ROLE_META[m.role];
            const Icon = meta.icon;
            const isSelf = m.user_id === user?.id;
            const canEditRow = canManageMembers && m.role !== 'owner' && !isSelf;
            return (
              <TableRow key={m.user_id}>
                <TableCell className="font-medium text-foreground">
                  {m.name ?? '—'} {isSelf && <span className="text-muted-foreground">(you)</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{m.email ?? '—'}</TableCell>
                <TableCell>
                  {canEditRow ? (
                    <Select
                      items={ROLE_ITEMS}
                      value={m.role}
                      onValueChange={(v) => changeRole(m.user_id, v as WorkspaceRole)}
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                    </span>
                  )}
                </TableCell>
                {canManageMembers && (
                  <TableCell>
                    {!isSelf && m.role !== 'owner' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeMember(m.user_id)}
                        aria-label={`Remove ${m.name ?? m.email}`}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {canManageMembers && invitations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Pending invitations</h3>
          <ul className="flex flex-col gap-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
              >
                <span className="text-foreground">
                  {inv.email} <span className="text-muted-foreground">— {inv.role}</span>
                  {inv.expired && (
                    <Badge variant="destructive" className="ml-2">
                      Expired
                    </Badge>
                  )}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => revokeInvitation(inv.id)}>
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isOwner && !canManageMembers && (
        <p className="text-xs text-muted-foreground">
          Only owners and admins can invite members or change roles.
        </p>
      )}
    </div>
  );
}

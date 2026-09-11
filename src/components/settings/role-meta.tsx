import { Crown, Shield, User, UserCog } from 'lucide-react';
import type { WorkspaceRole } from '@/lib/auth/roles';

/**
 * Per-role chip metadata — shared by the Sidebar's workspace strip
 * and the Members tab roster so recoloring/relabeling a role is a
 * one-file diff instead of two components drifting apart.
 */
export const ROLE_META: Record<
  WorkspaceRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    className: 'border-border bg-muted text-foreground',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    className: 'border-border bg-card text-muted-foreground',
  },
};

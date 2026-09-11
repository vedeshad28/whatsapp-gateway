'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  type WorkspaceRole,
} from '@/lib/auth/roles';

interface User {
  id: string;
  email: string;
  name: string | null;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  default_currency: string;
  role: WorkspaceRole;
}

interface AuthContextValue {
  user: User | null;
  /** True until the initial GET /api/account settles. */
  loading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch /api/account — call after a rename or role change. */
  refresh: () => Promise<void>;

  /** The user's first (in practice, usually only) workspace. Null until loaded, or for a workspace-less client (shouldn't happen for a signed-in dashboard user). */
  workspace: WorkspaceSummary | null;
  workspaceId: string | null;
  role: WorkspaceRole | null;
  defaultCurrency: string;
  isOwner: boolean;
  isAdmin: boolean;
  isAgent: boolean;
  isViewer: boolean;
  canManageMembers: boolean;
  canEditSettings: boolean;
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** AuthProvider — wrap the dashboard layout. One GET /api/account for the whole tree. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch('/api/account', { credentials: 'include' });
      if (!res.ok) {
        setUser(null);
        setWorkspace(null);
        return;
      }
      const json = (await res.json()) as {
        data: { user: User; workspaces: WorkspaceSummary[] };
      };
      setUser(json.data.user);
      setWorkspace(json.data.workspaces[0] ?? null);
    } catch (err) {
      console.error('[AuthProvider] fetchAccount failed:', err);
      setUser(null);
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setWorkspace(null);
    window.location.href = '/login';
  }, []);

  const derived = useMemo(() => {
    const role = workspace?.role ?? null;
    return {
      role,
      isOwner: role === 'owner',
      isAdmin: role === 'admin',
      isAgent: role === 'agent',
      isViewer: role === 'viewer',
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [workspace?.role]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signOut,
        refresh: fetchAccount,
        workspace,
        workspaceId: workspace?.id ?? null,
        defaultCurrency: workspace?.default_currency ?? DEFAULT_CURRENCY,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** useAuth — read the shared auth state. Must be used inside an <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider — account
    // state collapses to least-privileged null so every `canX` gate
    // fails closed instead of crashing.
    return {
      user: null,
      loading: false,
      signOut: async () => {
        window.location.href = '/login';
      },
      refresh: async () => {},
      workspace: null,
      workspaceId: null,
      role: null,
      defaultCurrency: DEFAULT_CURRENCY,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
    };
  }
  return ctx;
}

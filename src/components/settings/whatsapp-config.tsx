'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { CheckCircle2, XCircle } from 'lucide-react';

interface StatusResponse {
  connected: boolean;
  reason?: string;
  phone_info?: { display_phone_number?: string; verified_name?: string };
}

export function WhatsappConfigSettings() {
  const { workspaceId, canEditSettings } = useAuth();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pin, setPin] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/whatsapp?workspace_id=${workspaceId}`);
    if (res.ok) {
      const json = await res.json();
      setStatus(json.data);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConnecting(true);

    const res = await fetch('/api/account/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        phone_number_id: phoneNumberId,
        waba_id: wabaId || undefined,
        access_token: accessToken,
        pin: pin || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setConnecting(false);

    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      return;
    }
    if (json.data?.registration_error) {
      setError(`Connected, but phone registration failed: ${json.data.registration_error}`);
    }
    setAccessToken('');
    setPin('');
    load();
  };

  const handleDisconnect = async () => {
    if (!workspaceId) return;
    await fetch('/api/account/whatsapp', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    load();
  };

  if (!canEditSettings) {
    return (
      <p className="text-xs text-muted-foreground">
        Only owners and admins can manage the WhatsApp connection.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading connection status...</p>;
  }

  if (status?.connected) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>
            Connected — {status.phone_info?.verified_name ?? 'WhatsApp Business'}{' '}
            {status.phone_info?.display_phone_number ? `(${status.phone_info.display_phone_number})` : ''}
          </span>
        </div>
        <Button variant="destructive" onClick={handleDisconnect} className="w-fit">
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {status?.reason && status.reason !== 'no_account' && status.reason !== 'no_config' && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <XCircle className="size-4 shrink-0" />
          <span>Not connected ({status.reason})</span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        One-click signup needs the Meta app in Live mode with review approval — until then, connect
        manually with credentials from Meta Business Manager (WhatsApp → API Setup).
      </p>

      <form onSubmit={handleConnect} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone-number-id">Phone number ID</Label>
          <Input
            id="phone-number-id"
            required
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="waba-id">WABA ID (optional)</Label>
          <Input id="waba-id" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="access-token">Access token</Label>
          <Input
            id="access-token"
            type="password"
            required
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pin">Two-step verification PIN (optional, 6 digits)</Label>
          <Input id="pin" value={pin} onChange={(e) => setPin(e.target.value)} maxLength={6} />
        </div>
        <Button type="submit" disabled={connecting} className="w-fit disabled:opacity-50">
          {connecting ? 'Connecting...' : 'Connect'}
        </Button>
      </form>
    </div>
  );
}

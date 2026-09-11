'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { MessageSquare, UsersRound } from 'lucide-react';

interface PeekData {
  workspace_name: string;
  email: string;
  role: string;
}

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <AuthProvider>
      <JoinPageInner params={params} />
    </AuthProvider>
  );
}

function JoinPageInner({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { user, loading: authLoading, refresh } = useAuth();

  const [peek, setPeek] = useState<PeekData | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/invitations/${encodeURIComponent(token)}/peek`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setPeekError(json.error ?? 'This invitation is invalid or has expired');
          return;
        }
        setPeek(json.data);
      })
      .catch(() => setPeekError('Something went wrong'));
  }, [token]);

  const handleAccept = async () => {
    setRedeeming(true);
    setRedeemError(null);
    const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/redeem`, {
      method: 'POST',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRedeemError(json.error ?? 'Something went wrong');
      setRedeeming(false);
      return;
    }
    await refresh();
    router.push('/dashboard');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <UsersRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">You&apos;re invited</CardTitle>
          {peek && (
            <CardDescription className="text-muted-foreground">
              Join <strong className="text-foreground">{peek.workspace_name}</strong> as{' '}
              {peek.role}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {peekError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
              {peekError}
            </div>
          )}
          {redeemError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
              {redeemError}
            </div>
          )}

          {!peekError && !authLoading && !user && (
            <div className="flex flex-col gap-2">
              <Button
                render={<Link href={`/login?invite=${encodeURIComponent(token)}`} />}
                className="h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Sign in to accept
              </Button>
              <Button
                variant="outline"
                render={<Link href={`/signup?invite=${encodeURIComponent(token)}`} />}
                className="h-10 w-full"
              >
                <MessageSquare className="size-4" />
                Create an account
              </Button>
            </div>
          )}

          {!peekError && user && (
            <Button
              onClick={handleAccept}
              disabled={redeeming}
              className="h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {redeeming ? 'Joining...' : `Accept as ${user.email}`}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

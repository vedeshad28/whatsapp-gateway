import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MessageSquare } from 'lucide-react';

// Self-rolled auth (Phase 0) has no email transport wired up yet — the
// old wacrm flow delegated password-reset email delivery to Supabase
// Auth, which this restoration deliberately doesn't reintroduce (see
// the CRM restoration plan's auth decision). A real "forgot password"
// flow (reset-token table + SMTP/email-provider integration) is a
// follow-up, not built here to avoid shipping a half-finished, token-
// generating-but-never-delivered feature. Until then this page just
// tells the user how to actually get unblocked.
export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">Reset your password</CardTitle>
          <CardDescription className="text-muted-foreground">
            Self-service password reset isn&apos;t available yet on this instance — ask a
            workspace owner or admin to help you regain access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            render={<Link href="/login" />}
            className="h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

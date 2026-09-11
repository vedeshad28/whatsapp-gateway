import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DashboardShell } from './dashboard-shell';

// A client component (DashboardShell) can't export `metadata`, so
// this server layout carries it and just renders the shell.
export const metadata: Metadata = {
  robots: { index: false, follow: false, noimageindex: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}

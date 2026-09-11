import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Shared metadata for auth pages (login / signup / forgot-password) —
// none of these should be indexed.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}

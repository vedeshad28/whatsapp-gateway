// ============================================================
// Dashboard page-route gate (Next.js 16 renamed `middleware` to
// `proxy` — see AGENTS.md, this is NOT the pre-16 API). Runs on the
// Node.js runtime unconditionally (proxy can't run on edge), so it's
// safe to do a real Prisma-backed session lookup here rather than
// trusting cookie presence alone.
//
// Scope: this ONLY gates the CRM dashboard's page routes (redirect
// signed-out users away from /dashboard etc., redirect signed-in
// users away from /login etc.). It deliberately does NOT touch
// /api/v1/* or /api/whatsapp/* — those are the gateway's public API,
// authenticated per-route via requireApiKey() (see
// src/lib/auth/api-context.ts), exactly as they are today. The
// pre-restoration version of this file (when it was wacrm's
// middleware.ts) DID 401 unauthenticated /api/whatsapp/* calls, but
// back then every route under that prefix was a session-gated
// dashboard endpoint. Post-gateway-trim, /api/whatsapp/* is entirely
// API-key gateway surface that salon-saas calls with no session
// cookie — reinstating that rule here would 401 every real gateway
// call. Any dashboard-only write route restored in a later phase
// (e.g. broadcast, react, ai/*, automations/*) must call
// requireSession() itself, the same per-route discipline the gateway
// routes already use for requireApiKey().
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const PROTECTED_PATHS = [
  '/dashboard',
  '/inbox',
  '/contacts',
  '/pipelines',
  '/broadcasts',
  '/automations',
  '/flows',
  '/agents',
  '/notifications',
  '/settings',
];

const AUTH_PATHS = ['/login', '/signup', '/forgot-password'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const needsSessionCheck =
    AUTH_PATHS.includes(pathname) ||
    PROTECTED_PATHS.some((path) => pathname.startsWith(path));
  if (!needsSessionCheck) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionUser(token);

  if (session && AUTH_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    const inviteToken = request.nextUrl.searchParams.get('invite');
    if (inviteToken) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
    } else {
      url.pathname = '/dashboard';
    }
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!session && PROTECTED_PATHS.some((path) => pathname.startsWith(path))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

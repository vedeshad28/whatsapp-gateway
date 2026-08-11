// ============================================================
// Prisma client singleton.
//
// Next.js dev hot-reload re-executes this module on every edit; without
// caching on `globalThis` each reload would open a fresh pool of Postgres
// connections until the DB runs out. Standard Next.js + Prisma pattern.
// ============================================================

import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

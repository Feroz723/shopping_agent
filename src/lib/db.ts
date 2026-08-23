import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  if (!process.env.DATABASE_URL) return null;
  try {
    return new PrismaClient();
  } catch {
    return null;
  }
}

export const prisma: PrismaClient | null =
  globalThis.__prisma ?? createPrismaClient() ?? null;

if (process.env.NODE_ENV !== "production" && prisma) {
  globalThis.__prisma = prisma;
}

export const isPrismaAvailable = () => Boolean(prisma && process.env.DATABASE_URL);

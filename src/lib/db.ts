import { PrismaClient } from '@prisma/client'

// Bump this when the Prisma schema changes — it busts the cached client
// so the dev server picks up new fields/tables without a full restart.
const SCHEMA_VERSION = 'v2-logs-text-field'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion?: string
}

// If the schema version changed since the client was cached, discard the old client.
if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion !== SCHEMA_VERSION) {
  try {
    void globalForPrisma.prisma.$disconnect()
  } catch {
    /* ignore */
  }
  globalForPrisma.prisma = undefined
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION
}


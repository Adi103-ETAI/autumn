// The generated Prisma client lives in prisma/generated (see prisma/schema.prisma)
// — a normal directory inside the repo, so electron-builder ships it.
import { PrismaClient } from '../../prisma/generated/client'

// Bump this when the schema changes — it busts the cached client
// so the dev server picks up new fields/tables without a full restart.
const SCHEMA_VERSION = 'v3-artifacts-sessions'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion?: string
}

// If the schema version changed since the client was cached, discard that client.
if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion !== SCHEMA_VERSION) {
  try {
    void globalForPrisma.prisma.$disconnect()
  } catch {
    // ignore
  }
  globalForPrisma.prisma = undefined
  globalForPrisma.prismaSchemaVersion = undefined
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

type PrismaClientLike = any;

declare global {
  // eslint-disable-next-line no-var
  var __wasellerPrisma__: PrismaClientLike | undefined;
}

const createClient = (): PrismaClientLike => {
  // Prioriza cliente generado local del workspace db para evitar conflictos de hoisting.
  let pkg: { PrismaClient?: new (...args: unknown[]) => PrismaClientLike };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pkg = require("../node_modules/@prisma/client") as {
      PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
    };
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pkg = require("@prisma/client") as {
      PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
    };
  }
  if (!pkg.PrismaClient) {
    throw new Error("PrismaClient no disponible. Ejecuta la generación de cliente Prisma.");
  }
  return new pkg.PrismaClient({ log: ["warn", "error"] });
};

export const prisma = global.__wasellerPrisma__ ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.__wasellerPrisma__ = prisma;
}

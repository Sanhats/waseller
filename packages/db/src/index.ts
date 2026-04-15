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

// Reutilizar el cliente en caliente (Next serverless, HMR en dev, un solo proceso en Railway).
if (!global.__wasellerPrisma__) {
  global.__wasellerPrisma__ = createClient();
}
export const prisma = global.__wasellerPrisma__;

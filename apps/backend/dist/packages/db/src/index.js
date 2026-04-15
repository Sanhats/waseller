"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const createClient = () => {
    // Prioriza cliente generado local del workspace db para evitar conflictos de hoisting.
    let pkg;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        pkg = require("../node_modules/@prisma/client");
    }
    catch {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        pkg = require("@prisma/client");
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
exports.prisma = global.__wasellerPrisma__;

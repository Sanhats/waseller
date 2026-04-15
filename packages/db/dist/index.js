"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
/** En Vercel (serverless), limita conexiones por instancia y alinea con pool transaction de Supabase. */
function adaptDatabaseUrlForServerless(url) {
    if (process.env.VERCEL !== "1")
        return url;
    try {
        const u = new URL(url);
        if (!u.searchParams.has("connection_limit")) {
            u.searchParams.set("connection_limit", "1");
        }
        if (u.port === "6543" && !u.searchParams.has("pgbouncer")) {
            u.searchParams.set("pgbouncer", "true");
        }
        return u.toString();
    }
    catch {
        return url;
    }
}
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
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl?.trim()) {
        throw new Error("DATABASE_URL no definida.");
    }
    return new pkg.PrismaClient({
        log: ["warn", "error"],
        datasources: {
            db: { url: adaptDatabaseUrlForServerless(databaseUrl.trim()) },
        },
    });
};
// Reutilizar el cliente en caliente (Next serverless, HMR en dev, un solo proceso en Railway).
if (!global.__wasellerPrisma__) {
    global.__wasellerPrisma__ = createClient();
}
exports.prisma = global.__wasellerPrisma__;

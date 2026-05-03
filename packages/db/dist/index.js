"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
/**
 * Pooler Supabase en puerto 6543 = modo transacción (PgBouncer). Sin `pgbouncer=true`,
 * Prisma usa prepared statements y Postgres devuelve 26000 "prepared statement sN does not exist"
 * al cambiar de conexión en el pool.
 *
 * @see https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
 */
function adaptDatabaseUrlForPooledPostgres(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        const isSupabaseTransactionPool = host.includes("pooler.supabase.com") && u.port === "6543";
        const isNeonPooler = host.includes("neon.tech") && host.includes("pooler");
        if ((isSupabaseTransactionPool || isNeonPooler) && !u.searchParams.has("pgbouncer")) {
            u.searchParams.set("pgbouncer", "true");
        }
        if (process.env.VERCEL === "1" && !u.searchParams.has("connection_limit")) {
            u.searchParams.set("connection_limit", "1");
        }
        return u.toString();
    }
    catch {
        return url;
    }
}
const createClient = () => {
    // En monorepos + Turbopack, paths relativos a node_modules suelen romperse.
    // La resolución de Node encuentra el `@prisma/client` correcto (workspace `@waseller/db`)
    // siempre que se haya corrido `prisma generate` para ese paquete.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("@prisma/client");
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
            db: { url: adaptDatabaseUrlForPooledPostgres(databaseUrl.trim()) },
        },
    });
};
// Reutilizar el cliente en caliente (Next serverless, HMR en dev, un solo proceso en Railway).
if (!global.__wasellerPrisma__) {
    global.__wasellerPrisma__ = createClient();
}
exports.prisma = global.__wasellerPrisma__;

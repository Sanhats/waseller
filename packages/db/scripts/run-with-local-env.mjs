/**
 * Carga `infra/env/.env.local` (o ENV_FILE) y ejecuta prisma con los argumentos dados.
 *
 * Uso:
 *   node scripts/run-with-local-env.mjs migrate dev --schema prisma/schema.prisma --name foo
 *   node scripts/run-with-local-env.mjs db push --schema prisma/schema.prisma
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultEnv = resolve(__dirname, "../../../infra/env/.env.local");
const envPath = process.env.ENV_FILE?.trim() || defaultEnv;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    console.error(`No se encontró el archivo de entorno: ${filePath}`);
    console.error("Definí DATABASE_URL en el entorno o creá infra/env/.env.local");
    process.exit(1);
  }
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(envPath);

const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error("Uso: node scripts/run-with-local-env.mjs <comando prisma...>");
  process.exit(1);
}

const child = spawn("npx", ["prisma", ...prismaArgs], {
  stdio: "inherit",
  shell: true,
  env: process.env,
  cwd: resolve(__dirname, "..")
});

child.on("exit", (code) => process.exit(code ?? 1));

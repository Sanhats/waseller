#!/usr/bin/env node
/**
 * Genera dos árboles listos para ser repos independientes (p. ej. Railway):
 *   - waseller-railway-workers
 *   - waseller-railway-whatsapp
 *
 * Requiere que existan `apps/workers` y `apps/whatsapp` en este monorepo.
 * Si ya los borraste, recuperalos desde git: `git restore apps/workers apps/whatsapp`
 * (o el commit donde aún estaban) y volvé a ejecutar este script.
 *
 * Uso: node scripts/export-railway-repos.mjs [--out <directorio_padre>]
 * Por defecto <directorio_padre> es el padre del monorepo (..).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseOutDir(argv) {
  const i = argv.indexOf("--out");
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.resolve(repoRoot, "..");
}

function shouldCopySource(absPath) {
  const rel = path.relative(repoRoot, absPath);
  if (!rel || rel === ".") return true;
  return !rel.split(path.sep).some((seg) => seg === "node_modules" || seg === "dist" || seg === ".git");
}

function copyIntoBundle(bundleRoot, relativePaths) {
  for (const rel of relativePaths) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(bundleRoot, rel);
    if (!existsSync(src)) {
      console.error(`Falta en el monorepo: ${rel}`);
      process.exit(1);
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest, {
      recursive: true,
      filter: (p) => shouldCopySource(p)
    });
  }
}

function writeJson(file, obj) {
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function stripUnusedSharedFromWhatsapp(bundleRoot) {
  const pkgPath = path.join(bundleRoot, "apps/whatsapp/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.dependencies?.["@waseller/shared"]) {
    delete pkg.dependencies["@waseller/shared"];
    writeJson(pkgPath, pkg);
  }
}

function copyGitignore(bundleRoot) {
  const g = path.join(repoRoot, ".gitignore");
  if (existsSync(g)) {
    cpSync(g, path.join(bundleRoot, ".gitignore"));
  }
}

const parentDir = parseOutDir(process.argv.slice(2));

const workersName = "waseller-railway-workers";
const whatsappName = "waseller-railway-whatsapp";
const workersRoot = path.join(parentDir, workersName);
const whatsappRoot = path.join(parentDir, whatsappName);

for (const root of [workersRoot, whatsappRoot]) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

copyIntoBundle(workersRoot, [
  "tsconfig.base.json",
  "packages/shared",
  "packages/queue",
  "packages/db",
  "apps/workers"
]);

copyIntoBundle(whatsappRoot, ["tsconfig.base.json", "packages/queue", "apps/whatsapp"]);

copyGitignore(workersRoot);
copyGitignore(whatsappRoot);
stripUnusedSharedFromWhatsapp(whatsappRoot);

writeJson(path.join(workersRoot, "package.json"), {
  name: workersName,
  private: true,
  version: "0.1.0",
  workspaces: ["packages/*", "apps/workers"],
  scripts: {
    "build:packages":
      "npm run build --workspace @waseller/shared && npm run build --workspace @waseller/queue && npm run build --workspace @waseller/db",
    build: "npm run build:packages && npm run build --workspace @waseller/workers",
    start: "node apps/workers/dist/apps/workers/src/index.js",
    dev: "npm run dev --workspace @waseller/workers"
  },
  engines: { node: ">=22" }
});

writeJson(path.join(whatsappRoot, "package.json"), {
  name: whatsappName,
  private: true,
  version: "0.1.0",
  workspaces: ["packages/*", "apps/whatsapp"],
  scripts: {
    "build:packages": "npm run build --workspace @waseller/queue",
    build: "npm run build:packages && npm run build --workspace @waseller/whatsapp",
    start: "node apps/whatsapp/dist/apps/whatsapp/src/index.js",
    dev: "npm run dev --workspace @waseller/whatsapp"
  },
  engines: { node: ">=22" }
});

console.log("Export listo:");
console.log(`  ${workersRoot}`);
console.log(`  ${whatsappRoot}`);
console.log("Siguiente: en cada carpeta, git init, npm install, npm run build, y conectar el repo a Railway (build: npm run build, start: npm start).");

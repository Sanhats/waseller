process.env.SMOKE_LOAD = "true";
if (!process.env.SMOKE_LOAD_MESSAGES) {
  process.env.SMOKE_LOAD_MESSAGES = "100";
}

await import("./smoke-check.mjs");

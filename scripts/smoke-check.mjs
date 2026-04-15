import { readFileSync, existsSync } from "node:fs";

const requiredFiles = [
  "apps/backend/src/main.ts",
  "apps/dashboard/src/app/leads/page.tsx",
  "packages/db/prisma/schema.prisma",
  "infra/docker-compose.yml"
];

const missing = requiredFiles.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error("Smoke check failed. Missing files:");
  missing.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

const compose = readFileSync("infra/docker-compose.yml", "utf8");
if (!compose.includes("redis")) {
  console.error("Smoke check failed. docker-compose missing required services.");
  process.exit(1);
}

const apiBase = process.env.SMOKE_API_BASE_URL ?? "http://localhost:3000/api";
const tenantId = process.env.SMOKE_TENANT_ID ?? process.env.NEXT_PUBLIC_TENANT_ID ?? process.env.DEFAULT_TENANT_ID;
let authToken = process.env.SMOKE_AUTH_TOKEN ?? "";
const smokeEmail = process.env.SMOKE_EMAIL ?? "admin@demo.local";
const smokePassword = process.env.SMOKE_PASSWORD ?? "demo123";
const smokeLoad = process.env.SMOKE_LOAD === "true";
const smokeLoadMessages = Number(process.env.SMOKE_LOAD_MESSAGES ?? 100);
const senderGlobalTps = Number(process.env.SENDER_GLOBAL_TPS ?? 4);

if (!tenantId) {
  console.error("Smoke check failed. Missing tenant id (SMOKE_TENANT_ID/DEFAULT_TENANT_ID).");
  process.exit(1);
}

const makeHeaders = (needsAuth = false) => {
  const headers = {
    "Content-Type": "application/json",
    "x-tenant-id": tenantId
  };
  if (needsAuth && authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
};

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!authToken) {
  const loginRes = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: makeHeaders(false),
    body: JSON.stringify({
      email: smokeEmail,
      password: smokePassword
    })
  });
  if (!loginRes.ok) {
    console.error("Smoke check failed. /auth/login:", loginRes.status, await loginRes.text());
    process.exit(1);
  }
  const loginBody = await loginRes.json();
  authToken = loginBody?.token ?? "";
}

if (!authToken) {
  console.error("Smoke check failed. Auth token not available.");
  process.exit(1);
}

const incomingPhone = `${process.env.SMOKE_PHONE_PREFIX ?? "549111"}${Date.now().toString().slice(-7)}`;
const incomingPayload = {
  phone: incomingPhone,
  message: "hola, me interesa saber precio y stock",
  timestamp: new Date().toISOString()
};

const incomingRes = await fetch(`${apiBase}/messages/incoming`, {
  method: "POST",
  headers: makeHeaders(false),
  body: JSON.stringify(incomingPayload)
});

if (!incomingRes.ok) {
  console.error("Smoke check failed. /messages/incoming:", incomingRes.status, await incomingRes.text());
  process.exit(1);
}

let leadFound = false;
for (let i = 0; i < 10; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  await new Promise((resolve) => setTimeout(resolve, 800));
  // eslint-disable-next-line no-await-in-loop
  const leadsRes = await fetch(`${apiBase}/leads`, {
    headers: makeHeaders(true)
  });
  if (!leadsRes.ok) continue;
  // eslint-disable-next-line no-await-in-loop
  const leads = await leadsRes.json();
  if (Array.isArray(leads) && leads.some((lead) => lead.phone === incomingPhone)) {
    leadFound = true;
    break;
  }
}

if (!leadFound) {
  console.error("Smoke check failed. Lead was not created from incoming pipeline.");
  process.exit(1);
}

if (!smokeLoad) {
  console.log("Smoke check passed: incoming -> lead pipeline OK.");
  process.exit(0);
}

const loadPhone = `${process.env.SMOKE_LOAD_PHONE_PREFIX ?? "549777"}${Date.now().toString().slice(-7)}`;
const requests = [];
for (let i = 1; i <= smokeLoadMessages; i += 1) {
  requests.push(
    fetch(`${apiBase}/conversations/${loadPhone}/reply`, {
      method: "POST",
      headers: makeHeaders(true),
      body: JSON.stringify({
        message: `[SMOKE_LOAD] message_${i}`
      })
    })
  );
}

const loadResponses = await Promise.all(requests);
const nonQueued = loadResponses.filter((response) => !response.ok).length;
if (nonQueued > 0) {
  console.error(`Smoke load failed. Non-queued requests: ${nonQueued}/${smokeLoadMessages}`);
  process.exit(1);
}

const waitMs = Number(process.env.SMOKE_LOAD_WAIT_MS ?? 30000);
await sleep(waitMs);

const convRes = await fetch(`${apiBase}/conversations/${loadPhone}`, {
  headers: makeHeaders(true)
});
if (!convRes.ok) {
  console.error("Smoke load failed. Could not read conversations:", convRes.status, await convRes.text());
  process.exit(1);
}

const conversation = await convRes.json();
const outgoingLoadMessages = Array.isArray(conversation)
  ? conversation.filter(
      (item) => item.direction === "outgoing" && String(item.message ?? "").includes("[SMOKE_LOAD]")
    )
  : [];

if (outgoingLoadMessages.length === 0) {
  const opsRes = await fetch(`${apiBase}/ops/queues`, {
    headers: makeHeaders(true)
  });
  if (!opsRes.ok) {
    console.error(
      "Smoke load failed. No outgoing persisted and no ops metrics available:",
      opsRes.status,
      await opsRes.text()
    );
    process.exit(1);
  }
  const opsBody = await opsRes.json();
  const outgoingQueue = Array.isArray(opsBody?.queues)
    ? opsBody.queues.find((queue) => queue.queue === "outgoing_messages")
    : null;
  const completed = outgoingQueue?.counts?.completed ?? 0;
  const failed = outgoingQueue?.counts?.failed ?? 0;

  if (completed <= 0 && failed <= 0) {
    console.error("Smoke load failed. Outgoing queue has no completed/failed evidence after load.");
    process.exit(1);
  }

  console.log(
    `Smoke load partial pass: queued=${smokeLoadMessages}, persisted=0, completed=${completed}, failed=${failed}`
  );
  process.exit(0);
}

const timestampsBySecond = new Map();
for (const item of outgoingLoadMessages) {
  const date = new Date(item.createdAt ?? item.created_at);
  const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}-${date.getUTCMinutes()}-${date.getUTCSeconds()}`;
  timestampsBySecond.set(key, (timestampsBySecond.get(key) ?? 0) + 1);
}
const maxPerSecond = Math.max(...timestampsBySecond.values(), 0);
const allowedMaxPerSecond = Math.max(senderGlobalTps + 2, 1);
if (maxPerSecond > allowedMaxPerSecond) {
  console.error(
    `Smoke load failed. Global throughput exceeded cap: observed=${maxPerSecond}, allowed=${allowedMaxPerSecond}`
  );
  process.exit(1);
}

console.log(
  `Smoke check passed: incoming->lead OK + load OK (queued=${smokeLoadMessages}, persisted=${outgoingLoadMessages.length}, max_per_sec=${maxPerSecond})`
);

import { NextResponse } from "next/server";
import { prisma } from "@waseller/db";
import { authRuntimeEnvFromProcess, loginUser } from "@waseller/api-core";
import { TENANT_HEADER } from "@waseller/shared";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { email?: string; password?: string; tenantId?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string; tenantId?: string };
  } catch {
    return NextResponse.json({ message: "JSON inválido" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ message: "email y password son requeridos" }, { status: 400 });
  }

  const headerTenant = req.headers.get(TENANT_HEADER)?.trim();
  const tenantId = (typeof body.tenantId === "string" ? body.tenantId.trim() : undefined) || headerTenant;

  const runtime = authRuntimeEnvFromProcess(process.env);
  const r = await loginUser(prisma, runtime, { email, password, tenantId });

  if (!r.ok) {
    return NextResponse.json({ message: r.error.message }, { status: r.error.status });
  }
  return NextResponse.json(r.data);
}

import { NextResponse } from "next/server";
import { prisma } from "@waseller/db";
import { authRuntimeEnvFromProcess, registerTenantUser } from "@waseller/api-core";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  let body: {
    tenantName?: string;
    whatsappNumber?: string;
    email?: string;
    password?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "JSON inválido" }, { status: 400 });
  }

  const tenantName = typeof body.tenantName === "string" ? body.tenantName : "";
  const whatsappNumber = typeof body.whatsappNumber === "string" ? body.whatsappNumber : "";
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  const runtime = authRuntimeEnvFromProcess(process.env);
  const r = await registerTenantUser(prisma, runtime, {
    tenantName,
    whatsappNumber,
    email,
    password
  });

  if (!r.ok) {
    return NextResponse.json({ message: r.error.message }, { status: r.error.status });
  }
  return NextResponse.json(r.data);
}

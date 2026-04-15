import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    service: "waseller-dashboard",
    api: "next-route-handlers-pilot"
  });
}

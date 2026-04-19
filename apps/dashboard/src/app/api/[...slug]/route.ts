import type { NextRequest } from "next/server";
import { dispatchApi } from "@/lib/api-gateway";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return dispatchApi(req, "GET", slug ?? []);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return dispatchApi(req, "HEAD", slug ?? []);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return dispatchApi(req, "POST", slug ?? []);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return dispatchApi(req, "PUT", slug ?? []);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return dispatchApi(req, "PATCH", slug ?? []);
}

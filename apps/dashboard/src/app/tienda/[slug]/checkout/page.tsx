import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { normalizeStoreConfig } from "@waseller/shared";
import { getTenantBySlug } from "../_lib/get-tenant";
import { CheckoutClient } from "./checkout.client";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Checkout" };
  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const name = cfg.brand.storeName || tenant.name;
  return { title: `${name} · Checkout` };
}

export default async function CheckoutPage({ params }: PageProps) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  return <CheckoutClient slug={slug} />;
}

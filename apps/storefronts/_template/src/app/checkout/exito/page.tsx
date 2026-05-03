import { CheckoutResult } from "../result.client";

export const metadata = { title: "Pago confirmado" };

export default async function Page({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const sp = (await searchParams) ?? {};
  return <CheckoutResult orderId={sp.order_id?.trim() || null} expected="approved" />;
}

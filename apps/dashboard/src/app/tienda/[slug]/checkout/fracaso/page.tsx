import { CheckoutResult } from "../checkout-result.client";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ order_id?: string }>;
};

export const metadata = { title: "Pago no completado" };

export default async function CheckoutFracasoPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const orderId = sp.order_id?.trim() || null;
  return <CheckoutResult slug={slug} orderId={orderId} expected="failure" />;
}

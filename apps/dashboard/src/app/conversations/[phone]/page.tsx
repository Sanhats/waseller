"use client";

import {
  FormEvent,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Archive, Bot, PauseCircle, UserRoundX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ConversationAsideContactSkeleton,
  ConversationHeaderContactSkeleton,
  ConversationMessagesSkeleton,
} from "@/components/page-skeletons";
import { Badge, Button, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

type ConversationMessage = {
  id: string;
  phone: string;
  message: string;
  direction: "incoming" | "outgoing";
  createdAt: string;
};

type Lead = {
  id: string;
  phone: string;
  customerName?: string;
  product?: string;
  status: string;
  /** Uso interno del backend; no mostrar al operador. */
  score?: number;
  hasStockReservation?: boolean;
  reservationExpiresAt?: string;
  profilePictureUrl?: string;
  lastMessage?: string;
};

type ConversationState = {
  state: string;
  botPaused: boolean;
  leadClosed: boolean;
  archived?: boolean;
};

const LEAD_STATUS_LABEL_ES: Record<string, string> = {
  listo_para_cobrar: "Pago a confirmar",
  caliente: "En gestión",
  interesado: "Interesado",
  consulta: "Consulta",
  frio: "Nuevo",
  vendido: "Vendido",
  cerrado: "Descartado",
};

function leadStatusLabel(status: string | undefined): string {
  if (!status) return "Desconocido";
  return LEAD_STATUS_LABEL_ES[status] ?? status.replace(/_/g, " ");
}

type PaymentLinkReview = {
  id: string;
  status: string;
  title: string;
  amount: number;
  currency: string;
  checkoutUrl: string | null;
  sandboxCheckoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
  paymentLinkSentAt: string | null;
  productName: string | null;
  variantAttributes: Record<string, string>;
  outboundMessagePreview: string | null;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api";
const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId =
    window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export default function ConversationPage({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const phone = useMemo(
    () => decodeURIComponent(resolvedParams.phone),
    [resolvedParams.phone],
  );
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [botPaused, setBotPaused] = useState(false);
  const [togglingBot, setTogglingBot] = useState(false);
  const [leadClosed, setLeadClosed] = useState(false);
  const [closingLead, setClosingLead] = useState(false);
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkReview[]>([]);
  const [sendingPaymentAttemptId, setSendingPaymentAttemptId] = useState<
    string | null
  >(null);
  const [preparingPaymentDraft, setPreparingPaymentDraft] = useState(false);
  const [archived, setArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [unarchiving, setUnarchiving] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [phone]);

  const onMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 80;
  };

  const loadData = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    try {
      const [messagesRes, leadsRes, stateRes, paymentLinksRes] =
        await Promise.all([
          fetch(`${API_BASE}/conversations/${encodeURIComponent(phone)}`, {
            headers: {
              Authorization: `Bearer ${auth.token}`,
              "x-tenant-id": auth.tenantId,
            },
            cache: "no-store",
          }),
          fetch(`${API_BASE}/leads?includeClosed=true`, {
            headers: {
              Authorization: `Bearer ${auth.token}`,
              "x-tenant-id": auth.tenantId,
            },
            cache: "no-store",
          }),
          fetch(
            `${API_BASE}/conversations/${encodeURIComponent(phone)}/state`,
            {
              headers: {
                Authorization: `Bearer ${auth.token}`,
                "x-tenant-id": auth.tenantId,
              },
              cache: "no-store",
            },
          ),
          fetch(
            `${API_BASE}/conversations/${encodeURIComponent(phone)}/payment-links`,
            {
              headers: {
                Authorization: `Bearer ${auth.token}`,
                "x-tenant-id": auth.tenantId,
              },
              cache: "no-store",
            },
          ),
        ]);

      if (!messagesRes.ok) throw new Error(await messagesRes.text());
      if (!leadsRes.ok) throw new Error(await leadsRes.text());
      if (!stateRes.ok) throw new Error(await stateRes.text());
      if (!paymentLinksRes.ok) throw new Error(await paymentLinksRes.text());

      setMessages((await messagesRes.json()) as ConversationMessage[]);
      setLeads((await leadsRes.json()) as Lead[]);
      const stateData = (await stateRes.json()) as ConversationState;
      setPaymentLinks((await paymentLinksRes.json()) as PaymentLinkReview[]);
      setBotPaused(stateData.botPaused);
      setLeadClosed(stateData.leadClosed);
      setArchived(Boolean(stateData.archived));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void loadData();
    const interval = window.setInterval(() => {
      void loadData();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [phone]);

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setSending(true);
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${encodeURIComponent(phone)}/reply`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      setDraft("");
      stickToBottomRef.current = true;
      await loadData();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  };

  const toggleBot = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setTogglingBot(true);
    try {
      const endpoint = botPaused ? "reopen" : "resolve";
      const response = await fetch(
        `${API_BASE}/conversations/${encodeURIComponent(phone)}/${endpoint}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { botPaused: boolean };
      setBotPaused(data.botPaused);
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar el estado del bot",
      );
    } finally {
      setTogglingBot(false);
    }
  };

  const archiveConversation = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(
      "¿Archivar esta conversación? Dejará de mostrarse en la lista lateral y en Clientes (misma bandeja). Los mensajes no se borran; podés restaurarla desde aquí si volvés a abrir el chat.",
    );
    if (!confirmed) return;
    setArchiving(true);
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${encodeURIComponent(phone)}/archive`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      setArchived(true);
      router.push("/conversations");
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "No se pudo archivar");
    } finally {
      setArchiving(false);
    }
  };

  const unarchiveConversation = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setUnarchiving(true);
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${encodeURIComponent(phone)}/unarchive`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      setArchived(false);
      await loadData();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "No se pudo restaurar");
    } finally {
      setUnarchiving(false);
    }
  };

  const closeLead = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(
      "¿Cerrar este lead? Se liberará la reserva activa y el próximo mensaje se tomará como un lead nuevo.",
    );
    if (!confirmed) return;

    setClosingLead(true);
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${encodeURIComponent(phone)}/close-lead`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as ConversationState;
      setBotPaused(data.botPaused);
      setLeadClosed(data.leadClosed);
      await loadData();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "No se pudo cerrar el lead");
    } finally {
      setClosingLead(false);
    }
  };

  const currentLead = leads.find((l) => l.phone === phone);
  const displayName =
    currentLead?.customerName?.trim() || currentLead?.phone || phone;

  const paymentLinkAwaitingManualSend = (item: PaymentLinkReview): boolean => {
    if (item.paymentLinkSentAt) return false;
    const hasUrl = Boolean(
      item.checkoutUrl?.trim() || item.sandboxCheckoutUrl?.trim(),
    );
    if (!hasUrl) return false;
    return item.status === "draft" || item.status === "pending";
  };

  const pendingPaymentLink =
    paymentLinks.find(paymentLinkAwaitingManualSend) ?? null;
  const latestSentPaymentLink =
    paymentLinks.find((item) => item.status === "link_generated") ?? null;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading, phone, error, paymentLinks]);

  const preparePaymentDraft = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setPreparingPaymentDraft(true);
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${encodeURIComponent(phone)}/payment-links/prepare`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
        },
      );
      const text = await response.text();
      if (!response.ok) throw new Error(text);
      stickToBottomRef.current = true;
      await loadData();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error
          ? err.message
          : "No se pudo generar el borrador de pago",
      );
    } finally {
      setPreparingPaymentDraft(false);
    }
  };

  const sendPreparedPaymentLink = async (attemptId: string) => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setSendingPaymentAttemptId(attemptId);
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${encodeURIComponent(phone)}/payment-links/${attemptId}/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      stickToBottomRef.current = true;
      await loadData();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error
          ? err.message
          : "No se pudo enviar el link de pago",
      );
    } finally {
      setSendingPaymentAttemptId(null);
    }
  };

  const formatVariantAttributes = (
    attributes: Record<string, string>,
  ): string => {
    const parts = Object.entries(attributes)
      .filter(([, value]) => String(value ?? "").trim().length > 0)
      .map(([key, value]) => `${key}: ${value}`);
    return parts.join(" · ");
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-3 md:p-4 lg:h-full lg:flex-row"
      aria-busy={loading}
    >
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <header className="border-b border-border bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]">
          <div className="flex flex-col gap-3 px-4 py-3 md:px-5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              {loading ? (
                <ConversationHeaderContactSkeleton />
              ) : (
                <div className="flex min-w-0 items-center gap-3">
                  {currentLead?.profilePictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={currentLead.profilePictureUrl}
                      alt=""
                      className="size-11 shrink-0 rounded-full object-cover ring-2 ring-border shadow-sm"
                    />
                  ) : (
                    <div className="grid size-11 shrink-0 place-items-center rounded-full bg-disabled-bg text-sm font-semibold text-muted ring-2 ring-border shadow-sm">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate text-section">{displayName}</h2>
                    <p className="text-label-ui text-muted-ui">+{phone}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4">
              <div
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/90 px-2.5 py-2 shadow-sm ring-1 ring-black/[0.02]"
                aria-label="Estado del chat"
              >
                {leadClosed ? (
                  <Badge
                    variant="warning"
                    icon={UserRoundX}
                    className="shrink-0"
                  >
                    Lead cerrado
                  </Badge>
                ) : null}
                {archived ? (
                  <Badge variant="warning" icon={Archive} className="shrink-0">
                    Archivada
                  </Badge>
                ) : null}
                <Badge
                  variant={botPaused ? "warning" : "active"}
                  icon={botPaused ? PauseCircle : Bot}
                  className="shrink-0"
                >
                  {botPaused ? "Bot pausado" : "Bot activo"}
                </Badge>
              </div>

              <div
                role="toolbar"
                aria-label="Acciones del chat"
                className="flex flex-wrap items-center gap-2 sm:justify-end"
              >
                <Button
                  type="button"
                  variant={botPaused ? "primary" : "secondary"}
                  className="h-9 min-w-[7.5rem] shrink-0 rounded-lg px-3.5 text-xs font-semibold shadow-sm"
                  onClick={() => void toggleBot()}
                  disabled={loading || togglingBot}
                  loading={togglingBot}
                >
                  {botPaused ? "Reanudar bot" : "Resolver chat"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 shrink-0 rounded-lg border border-error/35 bg-error-bg px-3.5 text-xs font-semibold text-error shadow-sm hover:border-error/55 hover:bg-error-bg"
                  onClick={() => void closeLead()}
                  disabled={loading || closingLead}
                  loading={closingLead}
                >
                  Cerrar lead
                </Button>
                {archived ? (
                  <Button
                    type="button"
                    variant="primary"
                    className="h-9 shrink-0 rounded-lg px-3.5 text-xs font-semibold shadow-sm"
                    title="Volver a mostrar en el listado de conversaciones y clientes"
                    onClick={() => void unarchiveConversation()}
                    disabled={loading || unarchiving}
                    loading={unarchiving}
                  >
                    Volver al listado
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 shrink-0 rounded-lg border border-border bg-surface px-3.5 text-xs font-medium text-muted shadow-sm hover:border-primary/25 hover:bg-canvas hover:text-[var(--color-text)]"
                    onClick={() => void archiveConversation()}
                    disabled={loading || archiving}
                    loading={archiving}
                  >
                    Archivar del listado
                  </Button>
                )}
              </div>
            </div>
          </div>
        </header>

        {archived ? (
          <div className="border-b border-warning/30 bg-warning-bg px-4 py-2 text-center text-body text-[var(--color-text)] md:px-5">
            Esta conversación está archivada: no aparece en la lista hasta que
            pulses &quot;Volver a mostrar en el listado&quot;.
          </div>
        ) : null}

        <div
          ref={scrollRef}
          onScroll={onMessagesScroll}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-canvas px-4 py-4 md:px-5"
        >
          {error ? (
            <div
              className="rounded-md border border-error bg-error-bg px-3 py-2 text-body text-error"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {(pendingPaymentLink || latestSentPaymentLink) && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {pendingPaymentLink ? (
                  <Badge variant="warning">Link listo para revisar</Badge>
                ) : latestSentPaymentLink ? (
                  <Badge variant="sale">Link ya enviado</Badge>
                ) : null}
              </div>

              {pendingPaymentLink ? (
                <>
                  <p className="text-body font-semibold text-[var(--color-text)]">
                    {pendingPaymentLink.title}
                  </p>
                  {formatVariantAttributes(
                    pendingPaymentLink.variantAttributes,
                  ) ? (
                    <p className="text-label-ui text-muted-ui">
                      {formatVariantAttributes(
                        pendingPaymentLink.variantAttributes,
                      )}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-4 text-body text-[var(--color-text)]">
                    <span>
                      Monto:{" "}
                      {new Intl.NumberFormat("es-AR", {
                        style: "currency",
                        currency: pendingPaymentLink.currency,
                      }).format(pendingPaymentLink.amount)}
                    </span>
                    <span className="text-muted-ui">
                      Creado:{" "}
                      {new Date(pendingPaymentLink.createdAt).toLocaleString(
                        "es-AR",
                      )}
                    </span>
                  </div>
                  {pendingPaymentLink.outboundMessagePreview ? (
                    <div className="rounded-md border border-border bg-disabled-bg p-3">
                      <p className="text-label-ui font-semibold uppercase tracking-wide text-muted-ui">
                        Mensaje que se enviará por WhatsApp
                      </p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-body text-[var(--color-text)]">
                        {pendingPaymentLink.outboundMessagePreview}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={
                        pendingPaymentLink.checkoutUrl ??
                        pendingPaymentLink.sandboxCheckoutUrl ??
                        "#"
                      }
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-primary shadow-sm",
                        "hover:bg-canvas",
                      )}
                    >
                      Abrir checkout
                    </Link>
                    <Button
                      type="button"
                      variant="success"
                      onClick={() =>
                        void sendPreparedPaymentLink(pendingPaymentLink.id)
                      }
                      disabled={
                        sendingPaymentAttemptId === pendingPaymentLink.id
                      }
                      loading={
                        sendingPaymentAttemptId === pendingPaymentLink.id
                      }
                    >
                      Enviar link al cliente
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {loading && messages.length === 0 ? (
              <div className="flex flex-col gap-4 py-2">
                <div className="flex justify-center">
                  <Spinner size="sm" label="Cargando mensajes" />
                </div>
                <ConversationMessagesSkeleton bubbles={7} />
              </div>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-body text-muted-ui">
                Sin mensajes todavía.
              </p>
            ) : (
              messages.map((msg) => {
                const outgoing = msg.direction === "outgoing";
                return (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex",
                      outgoing ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[min(85%,28rem)] rounded-lg px-3.5 py-2.5 shadow-sm",
                        outgoing
                          ? "rounded-br-sm bg-chat-outgoing text-[var(--color-text)] ring-1 ring-primary/10"
                          : "rounded-bl-sm border border-border bg-chat-incoming text-[var(--color-text)]",
                      )}
                    >
                      <p
                        className={cn(
                          "whitespace-pre-wrap leading-relaxed",
                          outgoing
                            ? "text-[length:var(--text-body)] font-normal leading-[var(--text-body--line-height)] text-[var(--color-text)]"
                            : "text-body",
                        )}
                      >
                        {msg.message}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-right text-[11px] tabular-nums text-chat-meta",
                          outgoing ? "opacity-90" : "opacity-90",
                        )}
                      >
                        {new Date(msg.createdAt).toLocaleTimeString("es-AR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-surface">
          {(currentLead?.status === "listo_para_cobrar" ||
            currentLead?.hasStockReservation) &&
          !pendingPaymentLink &&
          !latestSentPaymentLink ? (
            <div className="border-b border-border border-l-[3px] border-l-growth-strong bg-gradient-to-r from-primary-ultra-light via-primary-ultra-light/50 to-surface px-3 py-3 md:px-4">
              <div className="flex justify-center sm:justify-end">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void preparePaymentDraft()}
                  disabled={loading || preparingPaymentDraft}
                  loading={preparingPaymentDraft}
                  className="w-full min-[480px]:w-auto rounded-lg border border-primary-active px-6 font-semibold shadow-md transition-[filter,box-shadow,colors] hover:bg-growth-hover hover:text-[var(--color-text)] hover:shadow-md sm:px-8"
                >
                  {preparingPaymentDraft
                    ? "Creando link…"
                    : "Crear link de pago"}
                </Button>
              </div>
            </div>
          ) : null}
          <form
            onSubmit={sendReply}
            className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end md:p-4"
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escribí un mensaje…"
              className="min-w-0 flex-1"
              disabled={loading}
            />
            <Button
              type="submit"
              disabled={loading || sending || draft.trim().length === 0}
              loading={sending}
              className="shrink-0"
            >
              Enviar
            </Button>
          </form>
        </div>
      </section>

      <aside
        className="hidden w-[280px] shrink-0 flex-col gap-8 overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-sm lg:flex"
        aria-busy={loading}
      >
        <div>
          <h3 className="text-section">Información</h3>
          {loading ? (
            <div className="mt-2 flex flex-col items-center gap-3">
              <Spinner size="sm" label="Cargando datos del contacto" />
              <ConversationAsideContactSkeleton />
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col items-center gap-3 text-center">
                {currentLead?.profilePictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentLead.profilePictureUrl}
                    alt=""
                    className="size-[4.5rem] rounded-full object-cover"
                  />
                ) : (
                  <div className="grid size-[4.5rem] place-items-center rounded-full bg-disabled-bg text-xl font-semibold text-muted">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-section">{displayName}</p>
                  <p className="mt-0.5 text-label-ui text-muted-ui">+{phone}</p>
                </div>
              </div>

              <dl className="mt-6 space-y-4">
                {currentLead?.product ? (
                  <div>
                    <dt className="text-label-ui text-muted-ui">
                      Producto de interés
                    </dt>
                    <dd className="mt-1 text-body font-medium text-[var(--color-text)]">
                      {currentLead.product}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-label-ui text-muted-ui">
                    Estado del lead
                  </dt>
                  <dd className="mt-1">
                    <Badge variant="default">
                      {leadStatusLabel(currentLead?.status)}
                    </Badge>
                  </dd>
                </div>
                {currentLead?.hasStockReservation ? (
                  <div>
                    <dt className="text-label-ui text-muted-ui">Reserva</dt>
                    <dd className="mt-1 text-body font-medium text-primary">
                      Activa
                    </dd>
                  </div>
                ) : null}
              </dl>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

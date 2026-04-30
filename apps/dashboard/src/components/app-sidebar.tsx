"use client";

import Image from "next/image";
import { Activity, Boxes, Building2, Home, LogOut, MessagesSquare, ShoppingBag, Store } from "lucide-react";
import { ComponentType } from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { SidebarWhatsappControl } from "@/components/sidebar-whatsapp-control";

type SectionKey = "home" | "leads" | "conversations" | "ops" | "stock" | "orders" | "tienda";

type NavIcon = ComponentType<{ size?: number; className?: string }>;

const navItems: Array<{
  key: SectionKey;
  href: string;
  label: string;
  icon: NavIcon;
}> = [
  { key: "home", href: "/", label: "Inicio", icon: Home },
  { key: "leads", href: "/leads", label: "Clientes", icon: Building2 },
  {
    key: "conversations",
    href: "/conversations",
    label: "Chats",
    icon: MessagesSquare,
  },
  { key: "ops", href: "/ops", label: "Negocio", icon: Activity },
  { key: "stock", href: "/stock", label: "Stock", icon: Boxes },
  { key: "orders", href: "/orders", label: "Ventas", icon: ShoppingBag },
  { key: "tienda", href: "/tienda-config", label: "Tienda", icon: Store },
];

const LOGO_SRC_WIDTH = 2000;
const LOGO_SRC_HEIGHT = 2000;

function readJwtExpMs(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    if (!payload.exp || !Number.isFinite(payload.exp)) return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function clearAuthAndRedirect(): void {
  try {
    window.localStorage.removeItem("ws_auth_token");
    window.localStorage.removeItem("ws_tenant_id");
  } catch {
    // ignore
  }
  window.location.href = "/login";
}

function BrandMark({ compact }: { compact: boolean }) {
  return (
    <a
      href="/"
      className={cn(
        "block min-w-0 shrink-0 overflow-hidden no-underline outline-none",
        "ring-1 ring-white/10 transition-opacity hover:opacity-90",
        "focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
        compact ? "w-[52px] rounded-xl ring-white/5" : "w-[140px] rounded-2xl",
      )}
      aria-label="Waseller — inicio"
    >
      <Image
        src="/logo-waseller-oficial.png"
        alt=""
        width={LOGO_SRC_WIDTH}
        height={LOGO_SRC_HEIGHT}
        className="h-auto w-full max-w-full object-contain object-center"
        sizes={compact ? "52px" : "140px"}
        priority
      />
    </a>
  );
}

/* ──────────────────────────────────────────────────────────
   COMPACT = bottom tab bar (mobile)
────────────────────────────────────────────────────────── */
export function AppSidebar({
  active,
  leadsCount,
  compact = false,
}: {
  active: SectionKey;
  leadsCount?: number;
  compact?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const token = window.localStorage.getItem("ws_auth_token") ?? "";
      const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
      if (!token || !tenantId) {
        clearAuthAndRedirect();
        return;
      }
      const exp = readJwtExpMs(token);
      if (exp && Date.now() >= exp) {
        clearAuthAndRedirect();
      }
    } catch {
      clearAuthAndRedirect();
    }
  }, []);

  if (compact) {
    return (
      <>
        <aside
          className="flex w-full shrink-0 flex-col border-t border-white/10"
          style={{
            background: "linear-gradient(180deg, #1c506a 0%, #14394f 100%)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <nav
            className="flex w-full items-stretch justify-around"
            style={{ height: "var(--mobile-nav-height, 62px)" }}
            aria-label="Navegación principal"
          >
            {navItems.map((item) => {
              const isActive = item.key === active;
              const Icon = item.icon;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  className={cn(
                    "relative flex flex-1 flex-col items-center justify-center gap-[3px] px-1 py-2",
                    "no-underline outline-none transition-all duration-fast",
                    "focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {/* Active pill */}
                  {isActive && (
                    <span
                      className="absolute inset-x-1.5 inset-y-1.5 rounded-xl"
                      style={{ backgroundColor: "var(--color-growth-base)" }}
                      aria-hidden
                    />
                  )}

                  <Icon
                    size={21}
                    className={cn(
                      "relative z-10 shrink-0 transition-colors duration-fast",
                      isActive ? "text-[var(--color-primary)]" : "text-white/55",
                    )}
                  />
                  <span
                    className={cn(
                      "relative z-10 text-[10px] font-semibold leading-none tracking-wide",
                      isActive ? "text-[var(--color-primary)]" : "text-white/50",
                    )}
                  >
                    {item.label}
                  </span>

                  {/* Leads badge */}
                  {item.key === "leads" &&
                    typeof leadsCount === "number" &&
                    leadsCount > 0 && (
                      <span className="absolute right-1.5 top-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-error px-1 text-[9px] font-bold text-white ring-2 ring-[#14394f]">
                        {leadsCount > 99 ? "99+" : leadsCount}
                      </span>
                    )}
                </a>
              );
            })}
          </nav>
        </aside>
      </>
    );
  }

  /* ──────────────────────────────────────────────────────────
     FULL = left sidebar (desktop)
  ────────────────────────────────────────────────────────── */
  return (
    <>
      <aside
        className="flex min-h-0 w-[268px] shrink-0 flex-col self-stretch border-r border-white/[0.07] py-5 pl-3.5 pr-3.5"
        style={{
          background: "linear-gradient(175deg, #1d526c 0%, #153c54 45%, #102e42 100%)",
        }}
      >
        {/* Logo */}
        <div className="flex w-full min-w-0 shrink-0 items-center justify-center px-2 pb-5">
          <BrandMark compact={false} />
        </div>

        {/* Divider */}
        <div className="mx-1 mb-3 h-px bg-white/[0.08]" />

        {/* Nav */}
        <nav
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-1"
          aria-label="Navegación principal"
        >
          {navItems.map((item) => {
            const isActive = item.key === active;
            const Icon = item.icon;
            return (
              <a
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm no-underline",
                  "transition-all duration-fast",
                  isActive
                    ? "bg-[var(--color-growth-base)] font-semibold text-[var(--color-primary)]"
                    : "font-normal text-white/65 hover:bg-white/[0.08] hover:text-white",
                )}
              >
                <Icon
                  size={17}
                  className={cn(
                    "shrink-0 transition-colors duration-fast",
                    isActive
                      ? "text-[var(--color-primary-active)]"
                      : "text-white/50 group-hover:text-white/85",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>

                {item.key === "leads" && typeof leadsCount === "number" ? (
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                      isActive
                        ? "bg-[var(--color-primary)]/12 text-[var(--color-primary)]"
                        : "bg-white/12 text-white/85",
                    )}
                  >
                    {leadsCount}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="mx-1 mt-3 mb-1 h-px bg-white/[0.08]" />

        <button
          type="button"
          onClick={() => clearAuthAndRedirect()}
          disabled={!mounted}
          className={cn(
            "mx-1 mb-2 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold",
            "border border-white/15 bg-white/5 text-white/80",
            "hover:bg-white/10 hover:text-white",
            "focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
          )}
          aria-label="Cerrar sesión"
        >
          <LogOut size={16} aria-hidden />
          Cerrar sesión
        </button>

        <SidebarWhatsappControl />
      </aside>
    </>
  );
}

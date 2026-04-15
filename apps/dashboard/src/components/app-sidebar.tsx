"use client";

import Image from "next/image";
import { Activity, Boxes, Building2, Home, MessagesSquare } from "lucide-react";
import { ComponentType } from "react";
import { cn } from "@/lib/cn";

type SectionKey = "home" | "leads" | "conversations" | "ops" | "stock";

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
    label: "Conversaciones",
    icon: MessagesSquare,
  },
  { key: "ops", href: "/ops", label: "Negocio", icon: Activity },
  { key: "stock", href: "/stock", label: "Stock", icon: Boxes },
];

const shell = "bg-primary text-white";

/** Ratio intrínseco del PNG (ancho × alto); solo afecta al layout de Next/Image, no estira el dibujo. */
const LOGO_SRC_WIDTH = 2000;
const LOGO_SRC_HEIGHT = 2000;

function BrandMark({ compact }: { compact: boolean }) {
  return (
    <a
      href="/"
      className={cn(
        "block min-w-0 w-1/4 shrink-0 overflow-hidden no-underline outline-none",
        "ring-1 ring-white/10",
        "focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
        compact ? "max-w-[5.5rem] rounded-xl ring-white/5" : "rounded-2xl",
      )}
      aria-label="Waseller — inicio"
    >
      <Image
        src="/logo-waseller-oficial.png"
        alt=""
        width={LOGO_SRC_WIDTH}
        height={LOGO_SRC_HEIGHT}
        className="h-auto w-full max-w-full object-contain object-center"
        sizes={compact ? "90px" : "120px"}
        priority
      />
    </a>
  );
}

export function AppSidebar({
  active,
  leadsCount,
  compact = false,
}: {
  active: SectionKey;
  leadsCount?: number;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col gap-2.5 border-b border-primary-active px-2.5 py-2.5",
          shell,
        )}
      >
        <div className="flex w-full min-w-0 items-center justify-center px-1">
          <BrandMark compact />
        </div>

        <nav className="flex gap-1.5 overflow-x-auto pb-0.5">
          {navItems.map((item) => {
            const isActive = item.key === active;
            const Icon = item.icon;
            return (
              <a
                key={item.key}
                href={item.href}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1.5 text-xs font-medium no-underline transition-colors duration-fast",
                  isActive
                    ? "border-growth-strong/40 bg-growth text-primary"
                    : "border-transparent bg-transparent text-white/75 hover:bg-primary-hover hover:text-white",
                )}
              >
                <Icon
                  size={14}
                  className={cn(isActive ? "text-primary" : "text-white/80")}
                />
                {item.label}
                {item.key === "leads" && typeof leadsCount === "number" ? (
                  <span
                    className={cn(
                      "ml-0.5 rounded-pill px-1 py-px text-[11px] font-medium tabular-nums",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "bg-white/20 text-white/95",
                    )}
                  >
                    {leadsCount}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex w-[260px] shrink-0 flex-col gap-6 border-r border-primary-active py-5 pl-3 pr-3",
        shell,
      )}
    >
      <div className="flex w-full min-w-0 items-center justify-center px-2">
        <BrandMark compact={false} />
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = item.key === active;
          const Icon = item.icon;
          return (
            <a
              key={item.key}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm no-underline transition-colors duration-fast",
                isActive
                  ? "bg-growth font-medium text-primary"
                  : "font-normal text-white/75 hover:bg-primary-hover hover:text-white",
              )}
            >
              <Icon
                size={16}
                className={cn(isActive ? "text-primary" : "text-white/80")}
              />
              {item.label}
              {item.key === "leads" && typeof leadsCount === "number" ? (
                <span
                  className={cn(
                    "ml-auto rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "bg-white/20 text-white/95",
                  )}
                >
                  {leadsCount}
                </span>
              ) : null}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

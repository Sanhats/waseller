"use client";

import { type LucideIcon } from "lucide-react";
import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant =
  | "default"
  | "active"
  | "warning"
  | "error"
  | "success"
  | "info"
  | "growth"
  | "sale";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  icon?: LucideIcon;
  children: ReactNode;
};

const variantClasses: Record<BadgeVariant, string> = {
  default: "border border-border bg-disabled-bg text-[var(--color-text)]",
  active: "border border-primary bg-[var(--badge-active-bg)] text-primary",
  warning: "border border-warning bg-warning-bg text-[var(--color-text)]",
  error: "border border-error bg-error-bg text-error",
  success: "border border-success bg-success-bg text-[var(--color-text)]",
  info: "border border-primary bg-info-bg text-primary",
  growth: "border border-growth-strong/40 bg-growth text-[var(--color-text)]",
  sale: "border border-growth-strong bg-growth-strong text-[var(--color-text)]"
};

export function Badge({ className, variant = "default", icon: Icon, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {Icon ? <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

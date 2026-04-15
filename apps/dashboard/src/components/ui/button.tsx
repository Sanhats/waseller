"use client";

import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "growth"
  | "success"
  | "info";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-primary text-white shadow-sm",
    "hover:bg-primary-hover active:bg-primary-active",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
  ),
  secondary: cn(
    "border border-growth-strong/40 bg-growth text-[var(--color-text)] shadow-sm",
    "hover:bg-growth-hover active:brightness-[0.98]",
    "active:scale-[0.98]",
    "focus-visible:ring-2 focus-visible:ring-growth-strong focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
  ),
  ghost: cn(
    "bg-transparent text-[var(--color-text)]",
    "hover:bg-canvas",
    "active:scale-[0.98]",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
  ),
  destructive: cn(
    "bg-error text-white shadow-sm",
    "hover:brightness-95 active:brightness-90",
    "focus-visible:ring-2 focus-visible:ring-error focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
  ),
  growth: cn(
    "border border-growth-strong/40 bg-growth text-[var(--color-text)] shadow-sm",
    "hover:bg-growth-hover active:brightness-[0.98]",
    "focus-visible:ring-2 focus-visible:ring-growth-strong focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
  ),
  success: cn(
    "border border-growth-strong/50 bg-success text-[var(--color-text)] shadow-sm",
    "hover:bg-growth-strong hover:brightness-[1.02] active:brightness-[0.98]",
    "focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
  ),
  info: cn(
    "border-2 border-primary bg-transparent text-primary shadow-sm",
    "hover:bg-growth hover:text-[var(--color-text)] hover:border-growth-strong/50",
    "active:scale-[0.98]",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
  )
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", loading = false, disabled, children, type = "button", ...props },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium",
        "transition-[transform,colors,opacity] duration-fast ease-default",
        "disabled:pointer-events-none disabled:opacity-50 disabled:bg-disabled-bg disabled:text-disabled",
        "disabled:border-border disabled:shadow-none",
        variantClasses[variant],
        variant === "destructive" && "disabled:bg-disabled-bg disabled:text-disabled",
        variant === "success" && "disabled:bg-disabled-bg disabled:text-disabled",
        variant === "info" && "disabled:border-border disabled:bg-transparent disabled:text-disabled",
        variant === "growth" && "disabled:border-border",
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

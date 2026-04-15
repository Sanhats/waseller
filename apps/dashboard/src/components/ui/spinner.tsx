"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const sizes = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-6",
} as const;

export type SpinnerProps = {
  className?: string;
  size?: keyof typeof sizes;
  /** Si se pasa, el spinner es anunciado a lectores de pantalla. */
  label?: string;
};

/** Indicador de carga circular (marca primaria). */
export function Spinner({ className, size = "md", label }: SpinnerProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center text-primary", className)}
      role={label ? "status" : "presentation"}
      aria-label={label}
      aria-live={label ? "polite" : undefined}
    >
      <Loader2 className={cn("animate-spin", sizes[size])} aria-hidden />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

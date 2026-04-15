"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TooltipProps = {
  content: string;
  children: ReactNode;
  className?: string;
  /** Posición del tooltip respecto al trigger */
  side?: "top" | "bottom";
};

export function Tooltip({ content, children, className, side = "top" }: TooltipProps) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-[240px] -translate-x-1/2 rounded-md px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-tooltip transition-opacity duration-tooltip ease-default",
          "bg-[var(--color-tooltip-bg)] text-[var(--color-tooltip-text)]",
          "group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2"
        )}
      >
        {content}
      </span>
    </span>
  );
}

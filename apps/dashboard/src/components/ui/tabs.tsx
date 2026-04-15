"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type TabsCtx = {
  value: string;
  setValue: (v: string) => void;
};

const TabsContext = createContext<TabsCtx | null>(null);

export type TabsProps = {
  /** Valor inicial si el tab es no controlado */
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
};

export function Tabs({ defaultValue = "", value: controlled, onValueChange, className, children }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const setValue = (v: string) => {
    if (controlled === undefined) setInternal(v);
    onValueChange?.(v);
  };

  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={cn("flex flex-col gap-4", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export type TabsListProps = { className?: string; children: ReactNode };

export function TabsList({ className, children }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex w-fit max-w-full flex-wrap gap-1 rounded-pill bg-canvas p-1 shadow-sm ring-1 ring-border",
        className
      )}
    >
      {children}
    </div>
  );
}

export type TabsTriggerProps = { value: string; className?: string; children: ReactNode };

export function TabsTrigger({ value, className, children }: TabsTriggerProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger must be used inside Tabs");

  const selected = ctx.value === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      id={`tab-${value}`}
      tabIndex={selected ? 0 : -1}
      data-state={selected ? "active" : "inactive"}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "rounded-pill px-4 py-2 text-sm font-medium transition-[background-color,color,transform] duration-fast ease-default",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
        "active:scale-[0.98]",
        selected
          ? "bg-primary text-white shadow-sm"
          : "bg-transparent text-muted hover:bg-surface hover:text-[var(--color-text)]",
        className
      )}
    >
      {children}
    </button>
  );
}

export type TabsContentProps = { value: string; className?: string; children: ReactNode };

export function TabsContent({ value, className, children }: TabsContentProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent must be used inside Tabs");

  if (ctx.value !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`panel-${value}`}
      aria-labelledby={`tab-${value}`}
      className={cn("min-h-[2rem] rounded-lg border border-border bg-surface p-4 shadow-sm", className)}
    >
      {children}
    </div>
  );
}

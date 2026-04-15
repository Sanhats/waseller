"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type RadioGroupCtx = {
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const RadioGroupContext = createContext<RadioGroupCtx | null>(null);

export type RadioGroupProps = {
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

export function RadioGroup({ name: nameProp, value, onValueChange, disabled, className, children }: RadioGroupProps) {
  const uid = useId();
  const name = nameProp ?? `radio-${uid.replace(/:/g, "")}`;

  return (
    <RadioGroupContext.Provider value={{ name, value, onChange: onValueChange, disabled }}>
      <div role="radiogroup" className={cn("flex flex-col gap-2", className)}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export type RadioItemProps = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function RadioItem({ value, label, disabled: itemDisabled }: RadioItemProps) {
  const ctx = useContext(RadioGroupContext);
  if (!ctx) throw new Error("RadioItem must be used inside RadioGroup");

  const disabled = ctx.disabled || itemDisabled;
  const checked = ctx.value === value;
  const id = `${ctx.name}-${value}`;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2.5",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <input
          id={id}
          type="radio"
          name={ctx.name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => ctx.onChange(value)}
          className="peer absolute inset-0 size-5 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          className={cn(
            "pointer-events-none flex size-5 items-center justify-center rounded-full border border-border bg-surface transition-colors duration-fast",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--color-bg)]",
            "peer-checked:border-primary peer-checked:bg-primary peer-checked:[&_.radio-dot]:opacity-100",
            "peer-disabled:border-border peer-disabled:bg-disabled-bg"
          )}
          aria-hidden
        >
          <span className="radio-dot size-2 rounded-full bg-white opacity-0 transition-opacity" />
        </span>
      </span>
      <span className="text-sm text-[var(--color-text)]">{label}</span>
    </label>
  );
}

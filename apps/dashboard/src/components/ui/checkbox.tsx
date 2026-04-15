"use client";

import { Check } from "lucide-react";
import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, id, disabled, ...props },
  ref
) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-start gap-2.5",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      <span className="relative mt-0.5 inline-flex size-5 shrink-0">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          disabled={disabled}
          className="peer absolute inset-0 size-5 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        />
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-md border border-border bg-surface transition-colors duration-fast",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--color-bg)]",
            "peer-checked:border-primary peer-checked:bg-primary peer-checked:[&_svg]:opacity-100",
            "peer-disabled:border-border peer-disabled:bg-disabled-bg"
          )}
          aria-hidden
        >
          <Check className="size-3.5 text-white opacity-0 transition-opacity" strokeWidth={3} />
        </span>
      </span>
      {label ? <span className="text-sm text-[var(--color-text)]">{label}</span> : null}
    </label>
  );
});

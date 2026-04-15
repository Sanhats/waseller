"use client";

import { forwardRef, type InputHTMLAttributes, useId } from "react";
import { cn } from "@/lib/cn";
import { Label } from "./label";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, hint, id: idProp, disabled, ...props },
  ref
) {
  const uid = useId();
  const id = idProp ?? uid;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <Label htmlFor={id} className={cn(disabled && "text-disabled")}>
          {label}
        </Label>
      ) : null}
      <input
        ref={ref}
        id={id}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "min-h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-[var(--color-text)]",
          "placeholder:text-muted",
          "transition-[border-color,box-shadow] duration-fast ease-default",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
          error
            ? "border-error focus-visible:ring-error"
            : "border-border focus-visible:border-primary",
          disabled && "cursor-not-allowed bg-disabled-bg text-disabled opacity-80",
          className
        )}
        {...props}
      />
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});

import { cn } from "@/lib/cn";

export type SkeletonProps = {
  className?: string;
};

/** Bloque de carga neutro (pulso) alineado con tokens `--color-disabled-bg`. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--color-disabled-bg)]", className)}
      aria-hidden
    />
  );
}

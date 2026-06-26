import { type VariantProps, cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.08em]",
  {
    variants: {
      variant: {
        neutral: "border-border-strong bg-bg-panel text-fg-muted",
        accent: "border-accent/40 bg-accent/10 text-accent",
        hidden: "border-hidden/40 bg-hidden/10 text-hidden-strong",
        outline: "border-border-strong text-fg-subtle",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

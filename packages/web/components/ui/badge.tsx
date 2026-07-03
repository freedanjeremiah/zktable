import { type VariantProps, cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Neo-brutalist badge: 2px black border, flat vibrant fill, black text —
// tiny siblings of the library's Button.
export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border-2 border-black px-2 py-0.5 font-mono text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-black",
  {
    variants: {
      variant: {
        neutral: "bg-white",
        accent: "bg-accent",
        hidden: "bg-hidden",
        outline: "bg-transparent",
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

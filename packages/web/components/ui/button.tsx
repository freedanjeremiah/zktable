import { type VariantProps, cva } from "class-variance-authority";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Neo-brutalist button, following the library's Button.tsx exactly:
// `border-black border-2`, flat vibrant fill that shifts a step on
// hover/active, and a hard offset shadow that appears on hover
// (2px for sm/md, 4px for lg) — no blur, pure black. Active snaps flat.
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] border-2 border-black font-display text-sm font-bold tracking-tight transition-all duration-150 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:pointer-events-none disabled:border-[#727272] disabled:bg-[#D4D4D4] disabled:text-[#676767] disabled:shadow-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-black hover:bg-accent-strong hover:shadow-[var(--shadow-brutal-sm)]",
        outline:
          "bg-white text-black hover:bg-bg-panel hover:shadow-[var(--shadow-brutal-sm)]",
        ghost:
          "border-transparent bg-transparent text-fg-muted hover:border-black hover:bg-white hover:text-black hover:shadow-[var(--shadow-brutal-sm)]",
        hidden:
          "bg-hidden text-black hover:bg-hidden-strong hover:shadow-[var(--shadow-brutal-sm)]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base hover:shadow-[var(--shadow-brutal)]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

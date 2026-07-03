"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * A minimal, dependency-free dialog built on the native <dialog> element —
 * gets focus-trapping, Escape-to-close, and ::backdrop for free from the
 * browser instead of reinventing them.
 */
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onClick={(e) => {
        if (e.target === ref.current) onOpenChange(false);
      }}
      className={cn(
        "m-auto w-full max-w-md rounded-[var(--radius-lg)] border-2 border-black bg-white p-0 text-fg shadow-[var(--shadow-brutal-lg)] backdrop:bg-black/40 open:animate-fade-up",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b-2 border-black bg-accent p-5">
        <div>
          <h2 className="font-display text-lg font-extrabold text-black">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm font-medium text-black/70">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => onOpenChange(false)}
          className="rounded-[var(--radius-sm)] border-2 border-black bg-white p-1 text-black transition-all hover:shadow-[var(--shadow-brutal-sm)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type CrmModalProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  actions?: ReactNode;
  busy?: boolean;
  size?: "md" | "lg";
};

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ventana de trabajo interna: conserva la ruta y el estado de la tabla,
 * limita el foco al diálogo y evita el desplazamiento del fondo.
 */
export default function CrmModal({
  open, title, description, children, onClose, closeLabel = "Cerrar", actions, busy = false, size = "md",
}: CrmModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled]), select:not([disabled])"
      );
      (firstField ?? dialogRef.current)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter(item => item.getClientRects().length > 0);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 px-3 py-4 sm:px-6">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          "flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-3xl bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200 " +
          (size === "lg" ? "max-w-4xl" : "max-w-3xl")
        }
      >
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7 sm:py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="break-words text-xl font-bold text-slate-950 sm:text-2xl">{title}</h2>
            {description && <p className="mt-1 break-words text-sm text-slate-600">{description}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label={closeLabel === "Cerrar" ? "Cerrar ventana" : closeLabel}
              className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {closeLabel}
            </button>
          </div>
        </header>
        <div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
          {children}
        </div>
      </section>
    </div>,
    document.body
  );
}

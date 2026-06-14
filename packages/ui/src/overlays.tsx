"use client";

import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { X } from "lucide-react";
import { type Currency } from "@aureus/shared";
import { Button } from "./controls";
import { Money } from "./money";
import { type Intent } from "./surfaces";
import { cn } from "./cn";

function Backdrop({ onClose }: { onClose?: () => void }): ReactElement {
  return (
    <div
      className="fixed inset-0 z-40 bg-abyss/70 backdrop-blur-sm motion-safe:animate-[fadeIn_120ms_ease-out]"
      onClick={onClose}
      aria-hidden="true"
    />
  );
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const MODAL_W: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Modal({ open, onClose, title, children, footer, size = "md", className }: ModalProps): ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div
          className={cn(
            "w-full overflow-hidden rounded-lg border border-hairline-strong bg-surface-1 shadow-2xl",
            MODAL_W[size],
            className,
          )}
        >
          {title ? (
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
              <h3 className="text-base font-medium text-text-hi">{title}</h3>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-sm p-1 text-text-lo hover:bg-surface-3 hover:text-text-hi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          <div className="px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3.5">{footer}</div> : null}
        </div>
      </div>
    </>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = "right",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  side?: "right" | "left";
  className?: string;
}): ReactElement | null {
  if (!open) return null;
  return (
    <>
      <Backdrop onClose={onClose} />
      <div
        className={cn(
          "fixed top-0 z-50 flex h-full w-full max-w-md flex-col border-hairline bg-surface-1 shadow-2xl",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          className,
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <h3 className="text-base font-medium text-text-hi">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-sm p-1 text-text-lo hover:bg-surface-3 hover:text-text-hi">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </>
  );
}

export interface MoneyDelta {
  label: string;
  currency?: Currency;
  beforeMinor: bigint | string;
  afterMinor: bigint | string;
}

/**
 * The before/after-balance confirm (docs/06 §4, docs/08 §7) shown on every money
 * movement (issue, transfer, recharge, approve, settle).
 */
export function ConfirmMoneyDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  deltas,
  confirmLabel = "Confirm",
  loading = false,
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  deltas: MoneyDelta[];
  confirmLabel?: string;
  loading?: boolean;
  danger?: boolean;
}): ReactElement {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <p className="mb-4 text-sm text-text-mid">{description}</p> : null}
      <div className="divide-y divide-hairline rounded-md border border-hairline">
        {deltas.map((d) => (
          <div key={d.label} className="flex items-center justify-between gap-4 px-3 py-2.5">
            <span className="text-sm text-text-mid">{d.label}</span>
            <span className="flex items-center gap-2">
              <Money valueMinor={d.beforeMinor} currency={d.currency} size="sm" className="opacity-60" />
              <span className="text-text-lo">→</span>
              <Money valueMinor={d.afterMinor} currency={d.currency} size="sm" />
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Audited-override reason capture (docs/06 §4: adjustments, KYC decisions, rejects). */
export function ReasonDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel = "Submit",
  placeholder = "Reason (recorded in the audit log)…",
  loading = false,
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  confirmLabel?: string;
  placeholder?: string;
  loading?: boolean;
  danger?: boolean;
}): ReactElement {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm(reason.trim());
            }}
            loading={loading}
            disabled={reason.trim().length < 2}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <textarea
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        placeholder={placeholder}
        className="min-h-[96px] w-full resize-y rounded-sm border border-hairline bg-surface-3 px-3 py-2 text-sm text-text-hi outline-none focus:ring-2 focus:ring-lumen/30"
      />
    </Modal>
  );
}

// ---- Toasts ------------------------------------------------------------------

export interface Toast {
  id: string;
  title: string;
  description?: string;
  intent?: Intent;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_BORDER: Record<Intent, string> = {
  neutral: "border-hairline",
  success: "border-success/40",
  warning: "border-warning/40",
  danger: "border-danger/40",
  info: "border-lumen/40",
  gold: "border-gold/40",
  ember: "border-ember/40",
};

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "rounded-md border bg-surface-2 px-4 py-3 shadow-lg motion-safe:animate-[slideIn_200ms_ease-out]",
              TOAST_BORDER[t.intent ?? "neutral"],
            )}
          >
            <div className="text-sm font-medium text-text-hi">{t.title}</div>
            {t.description ? <div className="mt-0.5 text-xs text-text-mid">{t.description}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

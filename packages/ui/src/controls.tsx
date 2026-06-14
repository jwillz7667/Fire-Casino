"use client";

import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from "react";
import { Search } from "lucide-react";
import { type Currency, fromMinor, MoneyError, toMinor } from "@aureus/shared";
import { CoinMark } from "./money";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-gold text-text-on-gold hover:bg-gold-light active:bg-gold-deep border border-gold-deep/40 font-semibold",
  secondary:
    "bg-transparent text-lumen border border-lumen/50 hover:bg-lumen/10 active:bg-lumen/15",
  ghost: "bg-transparent text-text-mid hover:bg-surface-3 hover:text-text-hi border border-transparent",
  danger: "bg-danger text-white hover:bg-danger/90 border border-danger/40 font-semibold",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm rounded-sm gap-1.5",
  md: "h-10 px-4 text-sm rounded-md gap-2",
  lg: "h-12 px-6 text-base rounded-md gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...props },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-lumen/70 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {loading ? <CoinMark size="xs" spin /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, ...props },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      aria-label={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md text-text-mid transition-colors",
        "hover:bg-surface-3 hover:text-text-hi focus-visible:ring-2 focus-visible:ring-lumen/70 outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

const FIELD_BASE =
  "w-full rounded-sm border border-hairline bg-surface-3 px-3 py-2 text-sm text-text-hi placeholder:text-text-lo outline-none transition-shadow focus:border-lumen/60 focus:ring-2 focus:ring-lumen/30 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
): ReactElement {
  return <input ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref): ReactElement {
    return <textarea ref={ref} className={cn(FIELD_BASE, "min-h-[80px] resize-y", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
): ReactElement {
  return (
    <select ref={ref} className={cn(FIELD_BASE, "appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-text-mid">
          {label}
          {required ? <span className="ml-0.5 text-danger">*</span> : null}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-text-lo">{hint}</span>
      ) : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-lumen/70",
          checked ? "bg-lumen" : "bg-surface-3",
          disabled && "opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-text-hi transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
      {label ? <span className="text-sm text-text-hi">{label}</span> : null}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}): ReactElement {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-hi">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="h-4 w-4 rounded-sm border-hairline bg-surface-3 accent-lumen"
      />
      {label}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-lo" />
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  );
}

export interface MoneyInputProps {
  /** Controlled minor-unit value (bigint) or undefined when empty. */
  valueMinor: bigint | undefined;
  onChangeMinor: (next: bigint | undefined) => void;
  currency?: Currency;
  minMinor?: bigint;
  maxMinor?: bigint;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Human-credit input that converts to BigInt minor units on change without any
 * float math (docs/03 §8, docs/08 §7). Shows a precision/range error inline and
 * reports the parsed minor value (or undefined) upward.
 */
export function MoneyInput({
  valueMinor,
  onChangeMinor,
  currency,
  minMinor,
  maxMinor,
  placeholder = "0.000",
  disabled,
  id,
  className,
}: MoneyInputProps): ReactElement {
  const fallbackId = useId();
  const [text, setText] = useState<string>(valueMinor === undefined ? "" : fromMinor(valueMinor));
  const [error, setError] = useState<string | undefined>();

  function handle(raw: string): void {
    setText(raw);
    if (raw.trim() === "") {
      setError(undefined);
      onChangeMinor(undefined);
      return;
    }
    try {
      const minor = toMinor(raw);
      if (minor < 0n) {
        setError("Must be positive");
        onChangeMinor(undefined);
        return;
      }
      if (minMinor !== undefined && minor < minMinor) {
        setError(`Minimum ${fromMinor(minMinor)}`);
      } else if (maxMinor !== undefined && minor > maxMinor) {
        setError(`Maximum ${fromMinor(maxMinor)}`);
      } else {
        setError(undefined);
      }
      onChangeMinor(minor);
    } catch (e) {
      setError(e instanceof MoneyError ? "Invalid amount" : "Invalid amount");
      onChangeMinor(undefined);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="relative">
        <CoinMark
          size="sm"
          variant={currency === "PRIZE" ? "ember" : "gold"}
          className="absolute left-2.5 top-1/2 -translate-y-1/2"
        />
        <Input
          id={id ?? fallbackId}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            handle(e.target.value);
          }}
          className={cn("pl-9 font-mono tabular-nums", error && "border-danger focus:ring-danger/30")}
        />
      </div>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}

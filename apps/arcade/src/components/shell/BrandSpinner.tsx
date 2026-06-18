import { BrandLogo } from "./BrandLogo";

const RING = { sm: "h-12 w-12", md: "h-[4.25rem] w-[4.25rem]", lg: "h-28 w-28" } as const;
const LOGO = { sm: "md", md: "lg", lg: "xl" } as const;

/**
 * Page-loading animation: the Goldwave gold "G" centered inside a spinning
 * gold ring. Drop-in replacement for the design system's CoinSpinner API.
 */
export function BrandSpinner({
  size = "md",
  label,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
}): React.ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-8"
      role="status"
      aria-live="polite"
    >
      <div className={`relative flex items-center justify-center ${RING[size]}`}>
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-gold-light/15 border-t-gold-light" />
        <BrandLogo size={LOGO[size]} glow priority />
      </div>
      {label ? (
        <span className="text-sm text-text-mid">{label}</span>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}

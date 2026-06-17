import Image from "next/image";

/** Sizes tuned to the old CoinMark scale so swaps are visually 1:1. */
const SIZES = { sm: 28, md: 36, lg: 56, xl: 96 } as const;

type BrandLogoSize = keyof typeof SIZES;

/** The Goldwave gold "G" emblem — canonical brand mark for the back-office console. */
export function BrandLogo({
  size = "md",
  glow = false,
  priority = false,
  className,
}: {
  size?: BrandLogoSize;
  glow?: boolean;
  priority?: boolean;
  className?: string;
}): React.ReactElement {
  const px = SIZES[size];
  return (
    <Image
      src="/brand/goldwave-logo.png"
      alt="Goldwave Casino"
      width={px}
      height={px}
      priority={priority}
      className={[
        "select-none object-contain",
        glow ? "drop-shadow-[0_0_14px_rgba(245,196,90,0.45)]" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

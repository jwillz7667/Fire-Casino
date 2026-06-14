import { clsx, type ClassValue } from "clsx";

/** Conditional className composer used across the design system. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export const UI_THEMES = ["console", "arcade"] as const;
export type UiTheme = (typeof UI_THEMES)[number];

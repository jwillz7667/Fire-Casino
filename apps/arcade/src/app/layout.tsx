import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fire Casino",
  description: "Play, load up, cash out.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en" data-theme="arcade">
      <body>{children}</body>
    </html>
  );
}

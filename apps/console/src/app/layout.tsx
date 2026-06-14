import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fire Casino — Console",
  description: "Back-office console for the Fire Casino platform.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en" data-theme="console">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/lib/query";

export const metadata: Metadata = {
  title: "Goldwave Console",
  description: "Back-office console for Goldwave Casino.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="en" data-theme="console">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import "@fontsource-variable/plus-jakarta-sans";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Receivy",
  description: "Cobranças pessoais claras para quem recebe e para quem paga.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1320" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The public charge page ships a nonce-only CSP (proxy.ts); without the nonce this inline script is blocked there.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

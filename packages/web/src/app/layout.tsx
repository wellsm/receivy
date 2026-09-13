import "@fontsource-variable/plus-jakarta-sans";
import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

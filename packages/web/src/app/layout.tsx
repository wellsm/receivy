import "@fontsource-variable/plus-jakarta-sans";
import { designTokens } from "@receivy/common";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Receivy",
  description: "Cobranças pessoais claras para quem recebe e para quem paga.",
};

const variables = {
  "--color-primary": designTokens.color.primary,
  "--color-primary-strong": designTokens.color.primaryStrong,
  "--color-primary-soft": designTokens.color.primarySoft,
  "--color-accent": designTokens.color.accent,
  "--color-canvas": designTokens.color.canvas,
  "--color-surface": designTokens.color.surface,
  "--color-surface-muted": designTokens.color.surfaceMuted,
  "--color-text": designTokens.color.text,
  "--color-text-muted": designTokens.color.textMuted,
  "--color-border": designTokens.color.border,
  "--color-danger": designTokens.color.danger,
} as CSSProperties;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" style={variables}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

import "@fontsource-variable/public-sans";
import "@fontsource-variable/space-grotesk";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { onSessionExpired } from "@/lib/api/client";
import { createAppRouter, leaveProtected, redirectToLogin } from "@/router";
import { watchSessionRemoval } from "@/lib/auth/session";
import "@/styles.css";

export const router = createAppRouter();

onSessionExpired(() => {
  redirectToLogin(router);
});

watchSessionRemoval(() => {
  leaveProtected(router);
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element in index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

import "@fontsource-variable/public-sans";
import "@fontsource-variable/space-grotesk";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAppRouter } from "@/router";
import { watchSessionRemoval } from "@/lib/auth/session";
import "@/styles.css";

export const router = createAppRouter();

watchSessionRemoval(() => {
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
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

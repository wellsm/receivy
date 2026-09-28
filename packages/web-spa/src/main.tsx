import "@fontsource-variable/public-sans";
import "@fontsource-variable/space-grotesk";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "@/route-tree.gen";
import { watchSessionRemoval } from "@/lib/auth/session";
import "@/styles.css";

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

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

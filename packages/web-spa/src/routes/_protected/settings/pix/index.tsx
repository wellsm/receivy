import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/settings/pix/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/payment-methods" });
  },
});

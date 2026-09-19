import { redirect } from "next/navigation";

export default function LegacyPixSettingsPage() {
  redirect("/settings/payment-methods");
}

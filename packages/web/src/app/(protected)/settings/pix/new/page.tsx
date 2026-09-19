import { redirect } from "next/navigation";

export default function LegacyPixKeyFormPage() {
  redirect("/settings/payment-methods/new");
}

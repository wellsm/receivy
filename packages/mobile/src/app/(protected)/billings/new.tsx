import { useRouter } from "expo-router";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";

export default function NewBillingRoute() {
  const router = useRouter();

  return (
    <BillingFormScreen
      onSaved={(billing) => router.replace({ pathname: "/billings/[id]", params: { id: billing.id } })}
      // The side trips go straight to the form screens: the lists have nothing to
      // add when the user already knows they are registering something new.
      onCreateContact={() => router.push("/contacts/new?returnTo=new-billing")}
      // The key of a conta a pagar belongs to whoever receives: it is registered on their contact.
      onEditContact={(contactId) => router.push({ pathname: "/contacts/[id]/edit", params: { id: contactId, returnTo: "new-billing" } })}
      onCreatePix={(required) =>
        router.push({ pathname: "/settings/payment-methods/new", params: { returnTo: "new-billing", ...(required ? { required: "1" } : {}) } })
      }
    />
  );
}

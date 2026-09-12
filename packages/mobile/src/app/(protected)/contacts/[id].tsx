import { useLocalSearchParams, useRouter } from "expo-router";
import { calendarDate, EMPTY_BILLING_DRAFT } from "@receivy/common";
import { ContactLedgerScreen } from "@/components/screens/contact-ledger-screen";
import { saveDraft } from "@/financial/draft-store";

export default function LedgerRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ContactLedgerScreen
      id={id}
      onNewCharge={(contact) => {
        // The billing form picks the parked draft up on focus, so the contact arrives already selected.
        saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", calendarDate()), selected: [contact.userId] });
        router.push("/billings/new");
      }}
      onEdit={() => router.push({ pathname: "/contacts/[id]/edit", params: { id } })}
      onOpenCharge={(chargeId) => router.push({ pathname: "/charges/[id]", params: { id: chargeId } })}
    />
  );
}

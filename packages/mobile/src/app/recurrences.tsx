import { useRouter } from "expo-router";
import { RecurrencesScreen } from "@/components/recurrences-screen";
export default function RecurrencesRoute() { const router = useRouter(); return <RecurrencesScreen onBack={() => router.back()} />; }

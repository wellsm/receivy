import { useRouter } from "expo-router";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
export default function SettingsRoute() { const router = useRouter(); return <PixSettingsScreen onBack={() => router.replace("/")} />; }

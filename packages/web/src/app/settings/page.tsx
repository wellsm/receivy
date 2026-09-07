import { AppShell } from "@/components/app-shell";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { NotificationSettings } from "@/components/notification-settings";
export default function SettingsPage() { return <AppShell activePath="/settings"><PixSettingsScreen /><NotificationSettings /></AppShell>; }

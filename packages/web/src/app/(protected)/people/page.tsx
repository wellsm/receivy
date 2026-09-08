import { AppShell } from "@/components/app-shell";
import { PeopleScreen } from "@/components/people-screen";

export default function PeoplePage() {
  return <AppShell activePath="/people"><PeopleScreen /></AppShell>;
}

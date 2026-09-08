"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FeedScreen } from "@/components/feed-screen";

export default function FeedPage() {
  const [notificationsBadge, setNotificationsBadge] = useState(false);

  return (
    <AppShell notificationsBadge={notificationsBadge}>
      <FeedScreen onSummary={(summary) => setNotificationsBadge(summary.proofsToReview > 0)} />
    </AppShell>
  );
}

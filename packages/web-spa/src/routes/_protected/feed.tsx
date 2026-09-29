import { createFileRoute } from "@tanstack/react-router";

// Stub so the path is registered; the next task replaces it with the real feed.
export const Route = createFileRoute("/_protected/feed")({ component: () => null });

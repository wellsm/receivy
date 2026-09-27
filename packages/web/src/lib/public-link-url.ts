import type { PublicLink } from "@receivy/common";

/** What a share hands out: the short `/p/<code>` when the link has one, the signed `/pay/<token>` otherwise. */
export function publicLinkUrl(origin: string, link: Pick<PublicLink, "token" | "shortCode">): string {
  if (link.shortCode) {
    return `${origin}/p/${encodeURIComponent(link.shortCode)}`;
  }

  return `${origin}/pay/${encodeURIComponent(link.token)}`;
}

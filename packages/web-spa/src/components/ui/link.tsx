import { Link as RouterLink } from "@tanstack/react-router";
import type { MouseEvent, ReactElement, ReactNode } from "react";

type LinkProps = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string | undefined>;
  replace?: boolean;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
  "aria-current"?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * Thin, loosely typed re-export of TanStack Router's `Link`. The route tree has no child routes
 * yet (Tasks 8/9 register them), so a real string literal `to` does not type-check against the
 * router's own, still-empty `FileRoutesByTo`. Task 12 may swap this back to the typed `Link` once
 * every route exists.
 */
export const Link = RouterLink as unknown as (props: LinkProps) => ReactElement;

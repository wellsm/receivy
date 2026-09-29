import { Link as RouterLink } from "@tanstack/react-router";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { parseSearch } from "@/lib/router-search";

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

type RouterLinkProps = Omit<LinkProps, "search"> & { search?: Record<string, string | string[] | undefined>; hash?: string };

/**
 * Thin, loosely typed re-export of TanStack Router's `Link`. The route tree has no child routes
 * yet (Tasks 8/9 register them), so a real string literal `to` does not type-check against the
 * router's own, still-empty `FileRoutesByTo`. Task 12 may swap this back to the typed `Link` once
 * every route exists.
 */
const RouterLinkLoose = RouterLink as unknown as (props: RouterLinkProps) => ReactElement;

/** Splits "/path?query#hash" so the router gets a pathname, a search and a hash instead of one opaque path. */
function splitTo(to: string): { pathname: string; search: Record<string, string | string[]>; hash?: string } {
  const hashAt = to.indexOf("#");
  const beforeHash = hashAt === -1 ? to : to.slice(0, hashAt);
  const hash = hashAt === -1 ? undefined : to.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");

  if (queryAt === -1) {
    return { pathname: beforeHash, search: {}, hash };
  }

  return { pathname: beforeHash.slice(0, queryAt), search: parseSearch(beforeHash.slice(queryAt + 1)), hash };
}

export function Link({ to, search, ...rest }: LinkProps): ReactElement {
  const split = splitTo(to);
  const hasQuery = Object.keys(split.search).length > 0;

  if (!hasQuery && split.hash === undefined) {
    return <RouterLinkLoose to={to} search={search} {...rest} />;
  }

  return <RouterLinkLoose to={split.pathname} search={{ ...split.search, ...search }} hash={split.hash} {...rest} />;
}

import { useNavigate } from "@tanstack/react-router";

type NavigateOptions = {
  replace?: boolean;
  search?: Record<string, string | undefined>;
};

type LooseNavigate = (options: { to?: string; href?: string; replace?: boolean; search?: Record<string, string | undefined> }) => void;

/**
 * Loosely typed wrapper around TanStack Router's `useNavigate`, for the dynamic string
 * destinations that do not type-check against the (still empty) route tree. Task 12 may retire
 * it once every route exists.
 */
export function useAppNavigate(): (to: string, options?: NavigateOptions) => void {
  const navigate = useNavigate() as unknown as LooseNavigate;

  return (to, options) => {
    // A target with search or hash only survives as a whole href; `to` is a bare path.
    if (to.includes("?") || to.includes("#")) {
      navigate({ href: to, ...options });

      return;
    }

    navigate({ to, ...options });
  };
}

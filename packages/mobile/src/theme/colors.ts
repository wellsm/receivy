import { useCSSVariable } from "uniwind";

export type ThemeColors = {
  canvas: string;
  surface: string;
  primary: string;
  primaryStrong: string;
  onPrimary: string;
  ink: string;
  muted: string;
  outline: string;
  danger: string;
  warning: string;
  info: string;
  success: string;
};

const NAMES = [
  "--color-canvas",
  "--color-surface",
  "--color-primary",
  "--color-primary-strong",
  "--color-on-primary",
  "--color-ink",
  "--color-muted",
  "--color-outline",
  "--color-danger",
  "--color-warning",
  "--color-info",
  "--color-success",
] as const;

/** Icon tints shared by the tab bars and the inline icons; they mirror `--color-primary-strong` and `--color-muted`. */
export const ACTIVE_TINT = "#003828";
export const MUTED_TINT = "#5B6470";

/** Colors for props that take a value instead of a className (tints, spinners, placeholders, navigation). */
export function useThemeColors(): ThemeColors {
  const [canvas, surface, primary, primaryStrong, onPrimary, ink, muted, outline, danger, warning, info, success] = useCSSVariable([...NAMES]).map(String);

  return { canvas, surface, primary, primaryStrong, onPrimary, ink, muted, outline, danger, warning, info, success };
}

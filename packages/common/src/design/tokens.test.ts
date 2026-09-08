import { describe, expect, it } from 'vitest';
import { designTokens } from './tokens';

// WCAG 2.1 relative luminance and contrast ratio (1.4.3 text AA = 4.5:1, 1.4.11 non-text = 3:1).
function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}
export function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

const c = designTokens.color;
describe('design token contrast', () => {
  it.each([
    ['body text on canvas', c.text, c.canvas],
    ['muted text on canvas', c.textMuted, c.canvas],
    ['muted text on muted surface', c.textMuted, c.surfaceMuted],
    ['body text on surface', c.text, c.surface],
    ['primary text on canvas', c.primary, c.canvas],
    ['strong primary text on canvas', c.primaryStrong, c.canvas],
    ['white label on primary button', c.surface, c.primary],
    ['strong primary label on soft primary badge', c.primaryStrong, c.primarySoft],
    ['danger text on canvas', c.danger, c.canvas],
    ['danger text on surface', c.danger, c.surface]
  ])('%s meets AA 4.5:1', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['primary focus ring on canvas', c.primary, c.canvas],
    ['primary focus ring on surface', c.primary, c.surface]
  ])('%s meets non-text 3:1', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(3);
  });

  // Known gap recorded in docs/mvp-acceptance.md (2026-09-07): the border token scores
  // about 1.6:1 against canvas and surface, below WCAG 1.4.11 for input boundaries, and
  // `accent` scores 1.7:1 so it must stay decorative. Changing them is a brand decision;
  // these assertions flip to failures (and must be promoted) once the tokens are fixed.
  it.fails.each([
    ['input border on canvas', c.border, c.canvas],
    ['input border on surface', c.border, c.surface],
    ['accent as a non-text indicator on canvas', c.accent, c.canvas]
  ])('%s still misses non-text 3:1 (documented design gap)', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(3);
  });
});

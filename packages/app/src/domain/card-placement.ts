import type { AnchorRect } from './types';

/** A plain width/height box — used for both the card's own rendered size and the viewport. */
export interface PlacementBox {
  width: number;
  height: number;
}

export interface CardPlacement {
  top: number;
  left: number;
}

// Mirrors --adp-space-8 (packages/app/src/ui/styles/tokens.ts:49) — a plain number, not a live
// read of the CSS custom property, because domain/ has no DOM access (rule-domain-purity). If
// the design system's spacing scale changes --adp-space-8, update this constant to match.
export const CARD_PLACEMENT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}

/**
 * A6: pure rect math that places the lookup card as an overlay that never covers the selected
 * sentence. Prefers directly below the selection (mirrors the Define trigger's own placement,
 * chrome-floating-trigger.ts:39-41); flips above when there is not enough room below
 * (viewport-clipped); clamps both axes so the card never renders off-screen. `anchor === null`
 * (no selection known yet — see the design spec §2.4) falls back to the pre-A6 default:
 * bottom-center. No DOM access — pure numbers in, numbers out (rule-domain-purity).
 */
export function computeCardPlacement(
  anchor: AnchorRect | null,
  card: PlacementBox,
  viewport: PlacementBox,
  margin: number = CARD_PLACEMENT_MARGIN,
): CardPlacement {
  const maxLeft = viewport.width - card.width - margin;
  const maxTop = viewport.height - card.height - margin;

  if (anchor === null) {
    return {
      top: clamp(viewport.height - card.height - margin, margin, maxTop),
      left: clamp((viewport.width - card.width) / 2, margin, maxLeft),
    };
  }

  const belowTop = anchor.y + anchor.h + margin;
  const fitsBelow = belowTop + card.height <= viewport.height - margin;
  const aboveTop = anchor.y - margin - card.height;
  const fitsAbove = aboveTop >= margin;

  const top = fitsBelow ? belowTop : fitsAbove ? aboveTop : clamp(belowTop, margin, maxTop);
  const left = clamp(anchor.x, margin, maxLeft);

  return { top, left };
}

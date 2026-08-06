import { describe, it, expect } from 'vitest';
import { computeCardPlacement, CARD_PLACEMENT_MARGIN } from '../src/domain/card-placement';
import type { AnchorRect } from '../src/domain/types';

const VIEWPORT = { width: 800, height: 600 };
const CARD = { width: 400, height: 200 };

describe('computeCardPlacement', () => {
  it('prefers directly below the selection when there is room', () => {
    const anchor: AnchorRect = { x: 100, y: 100, w: 50, h: 20 };
    expect(computeCardPlacement(anchor, CARD, VIEWPORT)).toEqual({
      top: 100 + 20 + CARD_PLACEMENT_MARGIN, // anchor.y + anchor.h + margin = 128
      left: 100,
    });
  });

  it('flips above the selection when there is not enough room below (viewport-clipped)', () => {
    const anchor: AnchorRect = { x: 100, y: 500, w: 50, h: 20 };
    // below: top = 500+20+8=528; 528+200=728 > 600-8=592 -> does not fit
    // above: top = 500-8-200=292; 292 >= 8 -> fits
    expect(computeCardPlacement(anchor, CARD, VIEWPORT)).toEqual({ top: 292, left: 100 });
  });

  it('clamps to the top of the viewport when the card fits neither above nor below', () => {
    const shortViewport = { width: 800, height: 150 }; // shorter than the card
    const anchor: AnchorRect = { x: 100, y: 50, w: 50, h: 20 };
    // below: top=50+20+8=78; 78+200=278 > 150-8=142 -> does not fit
    // above: top=50-8-200=-158; -158 < 8 -> does not fit
    // clamp(78, 8, 150-200-8=-58): max(-58) < min(8) -> resolves to margin (8)
    expect(computeCardPlacement(anchor, CARD, shortViewport)).toEqual({ top: 8, left: 100 });
  });

  it('clamps left up to the margin when the anchor is near/past the left edge', () => {
    const anchor: AnchorRect = { x: -50, y: 100, w: 50, h: 20 };
    expect(computeCardPlacement(anchor, CARD, VIEWPORT).left).toBe(CARD_PLACEMENT_MARGIN);
  });

  it("clamps left down so the card's right edge never passes the viewport's right edge", () => {
    const anchor: AnchorRect = { x: 700, y: 100, w: 50, h: 20 };
    // maxLeft = 800-400-8=392
    expect(computeCardPlacement(anchor, CARD, VIEWPORT).left).toBe(392);
  });

  it('falls back to the bottom-center default when anchor is null', () => {
    // top = clamp(600-200-8=392, 8, 392) = 392; left = clamp((800-400)/2=200, 8, 392) = 200
    expect(computeCardPlacement(null, CARD, VIEWPORT)).toEqual({ top: 392, left: 200 });
  });

  it('keeps the card on-screen (pinned to margin) even when the card is wider than the viewport', () => {
    const wideCard = { width: 900, height: 200 }; // wider than the 800px viewport
    const anchor: AnchorRect = { x: 300, y: 100, w: 50, h: 20 };
    // maxLeft = 800-900-8=-108; clamp(300, 8, -108): max(-108) < min(8) -> resolves to margin (8)
    expect(computeCardPlacement(anchor, wideCard, VIEWPORT).left).toBe(8);
  });

  it('honors a custom margin override', () => {
    const anchor: AnchorRect = { x: 100, y: 100, w: 50, h: 20 };
    // top = anchor.y + anchor.h + margin = 100+20+20=140
    expect(computeCardPlacement(anchor, CARD, VIEWPORT, 20)).toEqual({ top: 140, left: 100 });
  });
});

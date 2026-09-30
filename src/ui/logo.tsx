// The Wrapbox brand mark and wordmark — true vector SVGs, so they stay sharp
// at every size and pixel density. `tone="light"` renders ink-on-light (black
// + green); `tone="dark"` renders white-ink for dark surfaces. The green never
// changes between them.
import mark from "../assets/brand/wrapbox-mark.svg";
import markWhite from "../assets/brand/wrapbox-mark-white.svg";
import lockup from "../assets/brand/wrapbox-logo.svg";
import lockupWhite from "../assets/brand/wrapbox-logo-white.svg";

// Intrinsic aspect ratios (width ÷ height) of the SVG viewBoxes, so a given
// height yields the right width with no distortion.
const MARK_RATIO = 104 / 62;
const LOCKUP_RATIO = 640 / 104;

/** The "W" mark alone — for tab favicons, app-icon chips, small badges. */
export function WrapboxLogo({ size = 30, tone = "light", style }: { size?: number; tone?: "dark" | "light"; style?: React.CSSProperties }) {
  return (
    <img
      src={tone === "dark" ? markWhite : mark}
      alt="Wrapbox"
      width={Math.round(size * MARK_RATIO)}
      height={size}
      style={{ flexShrink: 0, display: "block", objectFit: "contain", ...style }}
    />
  );
}

/** The full lockup — mark + lowercase "wrapbox" wordmark, one SVG.
 *  `height` sets the exact rendered height in px (width follows, auto);
 *  `size` is the legacy text-size figure, kept for existing call sites. */
export function WrapboxWordmark({ tone = "light", size = 18, height, className }: { tone?: "dark" | "light"; size?: number; height?: number; className?: string }) {
  const h = height ?? Math.round(size * 1.9);
  return (
    <img
      src={tone === "dark" ? lockupWhite : lockup}
      alt="Wrapbox"
      className={className}
      width={Math.round(h * LOCKUP_RATIO)}
      height={h}
      style={{ flexShrink: 0, display: "block", objectFit: "contain", height: h, width: "auto" }}
    />
  );
}

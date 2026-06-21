import type { CSSProperties } from "react";

type AmbientBubble = {
  id: string;
  left: string;
  top: string;
  size: string;
  delay: string;
  duration: string;
  driftX: string;
  driftY: string;
};

const BUBBLES: AmbientBubble[] = [
  {
    id: "a",
    left: "6%",
    top: "14%",
    size: "88px",
    delay: "0s",
    duration: "9.2s",
    driftX: "10px",
    driftY: "-16px",
  },
  {
    id: "b",
    left: "78%",
    top: "8%",
    size: "64px",
    delay: "-2.4s",
    duration: "10.6s",
    driftX: "-8px",
    driftY: "-12px",
  },
  {
    id: "c",
    left: "84%",
    top: "46%",
    size: "96px",
    delay: "-4.8s",
    duration: "11.4s",
    driftX: "-12px",
    driftY: "14px",
  },
  {
    id: "d",
    left: "12%",
    top: "58%",
    size: "72px",
    delay: "-1.6s",
    duration: "8.8s",
    driftX: "14px",
    driftY: "10px",
  },
  {
    id: "e",
    left: "44%",
    top: "72%",
    size: "56px",
    delay: "-3.2s",
    duration: "9.8s",
    driftX: "6px",
    driftY: "-18px",
  },
  {
    id: "f",
    left: "62%",
    top: "24%",
    size: "48px",
    delay: "-5.6s",
    duration: "7.6s",
    driftX: "-6px",
    driftY: "12px",
  },
  {
    id: "g",
    left: "28%",
    top: "34%",
    size: "40px",
    delay: "-6.8s",
    duration: "8.4s",
    driftX: "8px",
    driftY: "-8px",
  },
];

/** Lightweight CSS-only ambient motion — bubbles + soft glow (GPU-friendly). */
export function SiteAmbientLayer() {
  return (
    <div className="site-ambient" aria-hidden="true">
      <div className="site-ambient__glow site-ambient__glow--one" />
      <div className="site-ambient__glow site-ambient__glow--two" />
      <div className="site-ambient__glow site-ambient__glow--three" />
      {BUBBLES.map((bubble) => (
        <div
          key={bubble.id}
          className={`site-ambient__bubble site-ambient__bubble--${bubble.id}`}
          style={
            {
              "--bubble-left": bubble.left,
              "--bubble-top": bubble.top,
              "--bubble-size": bubble.size,
              "--bubble-delay": bubble.delay,
              "--bubble-duration": bubble.duration,
              "--bubble-dx": bubble.driftX,
              "--bubble-dy": bubble.driftY,
            } as CSSProperties
          }
        />
      ))}
      <div className="site-ambient__spark site-ambient__spark--a" />
      <div className="site-ambient__spark site-ambient__spark--b" />
      <div className="site-ambient__spark site-ambient__spark--c" />
      <div className="site-ambient__shimmer" />
    </div>
  );
}

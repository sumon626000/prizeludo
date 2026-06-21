import type { CSSProperties, SVGProps } from "react";
import "./gaming-icons.css";

export type GamingIconName =
  | "ludo-dice"
  | "ludo-token"
  | "carrom-coin"
  | "carrom-striker"
  | "pool-ball"
  | "game-controller"
  | "trophy"
  | "wallet"
  | "referral"
  | "leaderboard"
  | "notification"
  | "start-play";

export type GamingIconMotion = "none" | "pulse" | "shine" | "float";

type GamingIconProps = {
  name: GamingIconName;
  size?: number;
  motion?: GamingIconMotion;
  className?: string;
  title?: string;
  style?: CSSProperties;
};

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.65,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconPaths({
  name,
  ...props
}: { name: GamingIconName } & SVGProps<SVGSVGElement>) {
  switch (name) {
    case "ludo-dice":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <rect x="4.5" y="4.5" width="15" height="15" rx="4.2" {...stroke} />
          <circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="15" cy="9" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="9" cy="15" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="15" cy="15" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );
    case "ludo-token":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12.5" r="6.8" {...stroke} />
          <circle cx="12" cy="12.5" r="3.6" fill="currentColor" opacity="0.22" stroke="none" />
          <path d="M9.2 8.4 12 5.6l2.8 2.8" {...stroke} />
          <path d="M12 5.6v2.2" {...stroke} />
          <circle cx="12" cy="12.5" r="1.35" fill="currentColor" stroke="none" />
        </svg>
      );
    case "carrom-coin":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="7.2" {...stroke} />
          <circle cx="12" cy="12" r="4.4" {...stroke} opacity="0.85" />
          <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
        </svg>
      );
    case "carrom-striker":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="7.4" {...stroke} />
          <circle cx="12" cy="12" r="5.1" fill="currentColor" opacity="0.14" stroke="none" />
          <path d="M12 4.8v2.2M12 17v2.2M4.8 12h2.2M17 12h2.2" {...stroke} />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pool-ball":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="7.2" {...stroke} />
          <path
            d="M5.2 12a6.8 6.8 0 0 1 13.6 0"
            fill="currentColor"
            opacity="0.18"
            stroke="none"
          />
          <circle cx="12" cy="12" r="2.8" {...stroke} />
          <text
            x="12"
            y="13.1"
            textAnchor="middle"
            fontSize="5.2"
            fontWeight="800"
            fill="currentColor"
            stroke="none"
            fontFamily="system-ui, sans-serif"
          >
            8
          </text>
        </svg>
      );
    case "game-controller":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path
            d="M8.2 9.4h2.1M9.25 8.35v2.1"
            {...stroke}
          />
          <circle cx="15.2" cy="9.8" r="0.95" fill="currentColor" stroke="none" />
          <circle cx="17.1" cy="11.7" r="0.95" fill="currentColor" stroke="none" />
          <path
            d="M6.8 12.2a7.2 7.2 0 0 1 10.4 0 4.6 4.6 0 0 1-10.4 0Z"
            {...stroke}
          />
          <path d="M4.8 12.2h16.4" {...stroke} opacity="0.55" />
        </svg>
      );
    case "trophy":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path d="M8.2 6.2h7.6v5.1a3.8 3.8 0 0 1-7.6 0V6.2Z" {...stroke} />
          <path d="M8.2 7.4H5.8a1.8 1.8 0 0 0 0 3.6h2.4M15.8 7.4h2.4a1.8 1.8 0 0 1 0 3.6h-2.4" {...stroke} />
          <path d="M12 15.1v2.1M9.1 19.2h5.8" {...stroke} />
          <path d="M8.6 17.2h6.8" {...stroke} />
        </svg>
      );
    case "wallet":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <rect x="4.5" y="6.8" width="15" height="10.4" rx="3.2" {...stroke} />
          <path d="M7.2 6.8V6a1.8 1.8 0 0 1 1.8-1.8h9.5" {...stroke} />
          <circle cx="16.4" cy="12" r="1.35" fill="currentColor" stroke="none" />
          <path d="M13.8 12h4.8" {...stroke} />
        </svg>
      );
    case "referral":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="9" cy="9.2" r="2.5" {...stroke} />
          <circle cx="16.2" cy="10.2" r="2.1" {...stroke} />
          <path d="M5.2 17.4a4.2 4.2 0 0 1 7.6 0" {...stroke} />
          <path d="M13.8 17.1a3.6 3.6 0 0 1 5.8.8" {...stroke} />
          <path d="M17.8 6.8 19.6 5l1.2 2.4-2.4.4" {...stroke} />
        </svg>
      );
    case "leaderboard":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path d="M6.4 18.2V11.8l3.2-2.2v8.6" {...stroke} />
          <path d="M10.4 18.2V8.6l3.2-2.1v11.7" {...stroke} />
          <path d="M14.4 18.2v-5.1l3.2-1.8v6.9" {...stroke} />
          <path d="M5.2 18.2h13.6" {...stroke} />
        </svg>
      );
    case "notification":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path
            d="M12 4.8c2.7 0 4.9 2.1 4.9 4.7v3.5l1.4 2.2a1 1 0 0 1-.9 1.5H6.6a1 1 0 0 1-.9-1.5l1.4-2.2V9.5c0-2.6 2.2-4.7 4.9-4.7Z"
            {...stroke}
          />
          <path d="M10.1 18.4a1.9 1.9 0 0 0 3.8 0" {...stroke} />
        </svg>
      );
    case "start-play":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="7.4" {...stroke} />
          <path
            d="M10.2 8.4l5.8 3.6-5.8 3.6V8.4Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    default:
      return null;
  }
}

export function GamingIcon({
  name,
  size = 24,
  motion = "none",
  className = "",
  title,
  style,
}: GamingIconProps) {
  const wrapClass = [
    "gaming-icon-wrap",
    motion !== "none" ? `gaming-icon-wrap--${motion}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={wrapClass}
      style={{ ...style, width: size, height: size }}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      title={title}
    >
      <IconPaths
        name={name}
        className="gaming-icon"
        width={size}
        height={size}
      />
    </span>
  );
}

export const GAMING_ICON_NAMES = [
  "ludo-dice",
  "ludo-token",
  "carrom-coin",
  "carrom-striker",
  "pool-ball",
  "game-controller",
  "trophy",
  "wallet",
  "referral",
  "leaderboard",
  "notification",
  "start-play",
] as const satisfies readonly GamingIconName[];

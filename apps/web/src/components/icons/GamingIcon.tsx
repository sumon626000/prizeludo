import type { CSSProperties, SVGProps } from "react";
import "./gaming-icons.css";

export type GamingIconName =
  | "ludo-dice"
  | "ludo-board"
  | "ludo-token"
  | "trade-chart"
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
    case "ludo-board":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2.8" {...stroke} />
          <path d="M3.2 12h17.6M12 3.2v17.6" stroke="currentColor" strokeWidth="0.8" opacity="0.28" />
          <path d="M3.2 3.2h6.2v6.2H3.2Z" fill="#f25b55" opacity="0.62" stroke="none" />
          <path d="M14.6 3.2H20.8v6.2H14.6Z" fill="#5cdb8b" opacity="0.62" stroke="none" />
          <path d="M14.6 14.6H20.8v6.2H14.6Z" fill="#ffd54a" opacity="0.62" stroke="none" />
          <path d="M3.2 14.6h6.2v6.2H3.2Z" fill="#5eb8ff" opacity="0.62" stroke="none" />
          <rect x="9.1" y="9.1" width="5.8" height="5.8" rx="1.1" fill="currentColor" opacity="0.14" stroke="none" />
          <path d="M12 9.1v5.8M9.1 12h5.8" stroke="currentColor" strokeWidth="0.75" opacity="0.35" />
          <circle cx="6.3" cy="6.3" r="1.25" fill="#fff8f0" stroke="#f25b55" strokeWidth="0.8" />
          <circle cx="17.7" cy="17.7" r="1.25" fill="#f0fff4" stroke="#5cdb8b" strokeWidth="0.8" />
          <circle cx="17.7" cy="6.3" r="1.1" fill="#fffef0" stroke="#ffd54a" strokeWidth="0.75" />
          <circle cx="6.3" cy="17.7" r="1.1" fill="#f0f8ff" stroke="#5eb8ff" strokeWidth="0.75" />
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
    case "trade-chart":
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path d="M4 19.5h16" stroke="currentColor" strokeWidth="1.1" opacity="0.35" />
          <path d="M4 15.5h16M4 11.5h16M4 7.5h16" stroke="currentColor" strokeWidth="0.55" opacity="0.16" />
          <line x1="6" y1="10.2" x2="6" y2="17.4" stroke="#f25b55" strokeWidth="1" />
          <rect x="5.1" y="12.4" width="1.8" height="4.2" rx="0.35" fill="#f25b55" />
          <line x1="9.5" y1="8.4" x2="9.5" y2="16.8" stroke="#5cdb8b" strokeWidth="1" />
          <rect x="8.6" y="9.8" width="1.8" height="5.6" rx="0.35" fill="#5cdb8b" />
          <line x1="13" y1="11.2" x2="13" y2="17.8" stroke="#f25b55" strokeWidth="1" />
          <rect x="12.1" y="13.2" width="1.8" height="3.8" rx="0.35" fill="#f25b55" />
          <line x1="16.5" y1="6.8" x2="16.5" y2="15.2" stroke="#5cdb8b" strokeWidth="1" />
          <rect x="15.6" y="7.8" width="1.8" height="6.4" rx="0.35" fill="#5cdb8b" />
          <path
            d="M5.6 15.8 9.2 11.6 12.4 13.1 17.8 7.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="17.8" cy="7.4" r="1.1" fill="currentColor" stroke="none" />
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
  "ludo-board",
  "ludo-token",
  "trade-chart",
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

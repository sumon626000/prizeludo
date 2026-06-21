import type { CSSProperties } from "react";
import { GamingIcon, type GamingIconName } from "./icons";

type BgIcon = {
  name: GamingIconName;
  left: string;
  top: string;
  size: number;
  delay: string;
  duration: string;
};

const ICONS: BgIcon[] = [
  { name: "ludo-dice", left: "8%", top: "12%", size: 34, delay: "0s", duration: "32s" },
  { name: "trophy", left: "86%", top: "10%", size: 36, delay: "-5s", duration: "34s" },
  { name: "carrom-coin", left: "16%", top: "38%", size: 30, delay: "-8s", duration: "36s" },
  { name: "game-controller", left: "82%", top: "52%", size: 38, delay: "-3s", duration: "30s" },
  { name: "pool-ball", left: "10%", top: "74%", size: 28, delay: "-11s", duration: "28s" },
  { name: "ludo-token", left: "72%", top: "82%", size: 32, delay: "-6s", duration: "33s" },
];

export function BgGameIcons() {
  return (
    <div className="bg-game-icons" aria-hidden="true">
      {ICONS.map((icon, index) => (
        <div
          key={`${icon.name}-${index}`}
          className="bg-game-icons__item"
          style={
            {
              "--bgi-left": icon.left,
              "--bgi-top": icon.top,
              "--bgi-size": `${icon.size}px`,
              "--bgi-delay": icon.delay,
              "--bgi-duration": icon.duration,
            } as CSSProperties
          }
        >
          <span className="bg-game-icons__bubble" aria-hidden="true" />
          <GamingIcon
            name={icon.name}
            size={icon.size}
            motion={index % 2 === 0 ? "float" : "shine"}
          />
        </div>
      ))}
    </div>
  );
}

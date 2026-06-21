import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(
  root,
  "apps",
  "web",
  "public",
  "tournament-artworks",
);

const themes = [
  { name: "Forest Crown", colors: ["#031f10", "#08753a", "#59e77f"], accent: "#f5ce48" },
  { name: "Waterfall Cup", colors: ["#052e35", "#087f8f", "#52e8df"], accent: "#e8fff8" },
  { name: "Desert Arena", colors: ["#381508", "#a44214", "#ffad35"], accent: "#ffd35a" },
  { name: "Tropical Treasure", colors: ["#022a26", "#08755c", "#45d9a5"], accent: "#ffd64f" },
  { name: "Volcano Clash", colors: ["#28060a", "#86131a", "#ff5b28"], accent: "#ffbf4d" },
  { name: "Crystal League", colors: ["#07152f", "#173c90", "#4ec9ff"], accent: "#bdf1ff" },
  { name: "Temple Masters", colors: ["#201006", "#76521a", "#d9a93d"], accent: "#fff08d" },
  { name: "Moonlight Royale", colors: ["#0c1230", "#303477", "#9c7cff"], accent: "#f1e7ff" },
  { name: "Emerald River", colors: ["#03251c", "#08745f", "#39d4b4"], accent: "#ddff91" },
  { name: "Golden Champions", colors: ["#2c1b03", "#8d5d07", "#f3b91d"], accent: "#fff2a0" },
];

function randomFactory(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function createBanner(index) {
  const theme = themes[(index - 1) % themes.length];
  const variant = Math.floor((index - 1) / themes.length) + 1;
  const random = randomFactory(index * 7919);
  const trees = Array.from({ length: 18 }, (_, treeIndex) => {
    const x = Math.round(random() * 720);
    const height = 30 + Math.round(random() * 72);
    const width = 14 + Math.round(random() * 25);
    const opacity = (0.16 + random() * 0.25).toFixed(2);
    const y = 214 - height;
    return `<path d="M${x} 214 L${x + width / 2} ${y} L${x + width} 214 Z" fill="${
      treeIndex % 2 ? theme.colors[2] : theme.colors[0]
    }" opacity="${opacity}"/>`;
  }).join("");
  const lights = Array.from({ length: 22 }, () => {
    const x = Math.round(20 + random() * 680);
    const y = Math.round(18 + random() * 190);
    const radius = (0.8 + random() * 2.2).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${theme.accent}" opacity="${(
      0.25 + random() * 0.65
    ).toFixed(2)}"/>`;
  }).join("");
  const ridge = 144 + Math.round(random() * 28);
  const themeName = escapeXml(theme.name);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="260" viewBox="0 0 720 260" role="img" aria-label="${themeName}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.colors[0]}"/>
      <stop offset="0.58" stop-color="${theme.colors[1]}"/>
      <stop offset="1" stop-color="${theme.colors[0]}"/>
    </linearGradient>
    <radialGradient id="halo">
      <stop offset="0" stop-color="${theme.colors[2]}" stop-opacity=".52"/>
      <stop offset="1" stop-color="${theme.colors[2]}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff39a"/>
      <stop offset=".38" stop-color="${theme.accent}"/>
      <stop offset="1" stop-color="#9c5c05"/>
    </linearGradient>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity=".55"/>
    </filter>
  </defs>
  <rect width="720" height="260" rx="28" fill="url(#bg)"/>
  <ellipse cx="360" cy="112" rx="245" ry="130" fill="url(#halo)"/>
  <path d="M0 ${ridge} Q110 ${ridge - 65} 220 ${ridge + 4} T445 ${ridge - 9} T720 ${ridge - 33} V260 H0 Z" fill="${theme.colors[0]}" opacity=".67"/>
  <path d="M0 202 Q120 154 240 205 T480 190 T720 195 V260 H0 Z" fill="#001b0d" opacity=".62"/>
  ${trees}
  ${lights}
  <g transform="translate(288 42)" filter="url(#shadow)">
    <path d="M21 17 H123 V53 C123 91 102 111 72 116 C42 111 21 91 21 53 Z" fill="url(#gold)" stroke="#fff1a0" stroke-width="3"/>
    <path d="M21 29 H4 V49 C4 76 21 88 43 88" fill="none" stroke="${theme.accent}" stroke-width="12" stroke-linecap="round"/>
    <path d="M123 29 H140 V49 C140 76 123 88 101 88" fill="none" stroke="${theme.accent}" stroke-width="12" stroke-linecap="round"/>
    <path d="M64 114 H80 V139 H111 V154 H33 V139 H64 Z" fill="url(#gold)"/>
    <path d="M72 43 L81 61 L101 64 L86 78 L90 98 L72 88 L54 98 L58 78 L43 64 L63 61 Z" fill="${theme.colors[1]}" stroke="#f4ffb0" stroke-width="2"/>
  </g>
  <g opacity=".76">
    <path d="M45 232 C94 182 139 182 191 229 C143 218 98 219 45 232 Z" fill="${theme.colors[2]}"/>
    <path d="M675 232 C626 182 581 182 529 229 C577 218 622 219 675 232 Z" fill="${theme.colors[2]}"/>
  </g>
  <rect x="20" y="18" width="680" height="224" rx="24" fill="none" stroke="${theme.colors[2]}" stroke-opacity=".35" stroke-width="2"/>
  <text x="676" y="224" text-anchor="end" fill="#fff" opacity=".45" font-family="Arial, sans-serif" font-size="18" font-weight="700">${String(variant).padStart(2, "0")}</text>
</svg>`;
}

await mkdir(outputDirectory, { recursive: true });

for (let index = 1; index <= 100; index += 1) {
  const filename = `tournament-${String(index).padStart(3, "0")}.svg`;
  await writeFile(path.join(outputDirectory, filename), createBanner(index), "utf8");
}

console.log(`Generated 100 tournament artworks in ${outputDirectory}`);

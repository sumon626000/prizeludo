import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAvatar } from "@dicebear/core";
import { personas } from "@dicebear/collection";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../apps/web/public/avatars");

mkdirSync(outDir, { recursive: true });

const seeds = [
  "prizejito-aria",
  "prizejito-bilal",
  "prizejito-chloe",
  "prizejito-daniel",
  "prizejito-elena",
  "prizejito-farhan",
  "prizejito-grace",
  "prizejito-hassan",
  "prizejito-isha",
  "prizejito-james",
  "prizejito-kavya",
  "prizejito-leo",
  "prizejito-maya",
  "prizejito-noah",
  "prizejito-olivia",
  "prizejito-priya",
  "prizejito-ryan",
  "prizejito-sofia",
  "prizejito-tariq",
  "prizejito-uma",
];

for (const [index, seed] of seeds.entries()) {
  const fileName = `face-${String(index + 1).padStart(2, "0")}.svg`;
  const svg = createAvatar(personas, {
    seed,
    size: 128,
    backgroundColor: ["0a2e1a", "123d24", "1a4d2e", "0d2818"],
    radius: 50,
  }).toString();

  writeFileSync(join(outDir, fileName), svg, "utf8");
  console.log(`Wrote ${fileName}`);
}

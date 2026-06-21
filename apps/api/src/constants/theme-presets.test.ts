import { describe, expect, it } from "vitest";
import {
  getThemePreset,
  presetToSettingValues,
  THEME_PRESET_IDS,
} from "./theme-presets.js";

describe("theme-presets", () => {
  it("exposes seven selectable presets", () => {
    expect(THEME_PRESET_IDS).toHaveLength(7);
    expect(THEME_PRESET_IDS).toContain("forest");
    expect(THEME_PRESET_IDS).toContain("midnight");
  });

  it("maps a preset to all site color settings", () => {
    const preset = getThemePreset("ocean");
    expect(preset).toBeTruthy();
    expect(presetToSettingValues(preset!)).toEqual({
      "site.theme_preset": "ocean",
      "site.primary_color": "#0ea5e9",
      "site.secondary_color": "#0c4a6e",
      "site.button_color": "#0284c7",
      "site.card_color": "#082f49",
      "site.background_color": "#020c17",
      "site.accent_color": "#7dd3fc",
    });
  });
});

import themePresetsData from "./theme-presets.data.json";

export type ThemePresetId =
  | "forest"
  | "ocean"
  | "royal"
  | "sunset"
  | "ruby"
  | "gold"
  | "midnight";

export type ThemePresetColors = {
  id: ThemePresetId;
  label: string;
  labelBn: string;
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  cardColor: string;
  backgroundColor: string;
  accentColor: string;
};

export type ThemePayload = {
  siteName?: string;
  logoUrl?: string;
  themePreset?: string;
  primaryColor?: string;
  secondaryColor?: string;
  buttonColor?: string;
  cardColor?: string;
  backgroundColor?: string;
  accentColor?: string;
};

export const THEME_PRESETS = themePresetsData.presets as ThemePresetColors[];

const presetMap = new Map(THEME_PRESETS.map((preset) => [preset.id, preset]));

export function getThemePreset(id: string): ThemePresetColors | null {
  return presetMap.get(id as ThemePresetId) ?? null;
}

export function presetToSettingValues(preset: ThemePresetColors) {
  return {
    "site.theme_preset": preset.id,
    "site.primary_color": preset.primaryColor,
    "site.secondary_color": preset.secondaryColor,
    "site.button_color": preset.buttonColor,
    "site.card_color": preset.cardColor,
    "site.background_color": preset.backgroundColor,
    "site.accent_color": preset.accentColor,
  };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function mixHex(base: string, overlay: string, overlayWeight: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(overlay);
  if (!a || !b) return base;
  const weight = Math.min(1, Math.max(0, overlayWeight));
  const mix = (left: number, right: number) =>
    Math.round(left * (1 - weight) + right * weight);
  const channels = [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function resolveThemePayload(theme: ThemePayload): ThemePayload {
  if (!theme.themePreset) return theme;
  const preset = getThemePreset(theme.themePreset);
  if (!preset) return theme;
  return {
    ...theme,
    primaryColor: preset.primaryColor,
    secondaryColor: preset.secondaryColor,
    buttonColor: preset.buttonColor,
    cardColor: preset.cardColor,
    backgroundColor: preset.backgroundColor,
    accentColor: preset.accentColor,
  };
}

export function applyTheme(theme: ThemePayload) {
  const resolved = resolveThemePayload(theme);
  const root = document.documentElement;
  const variables: Array<[keyof ThemePayload, string]> = [
    ["primaryColor", "--theme-primary"],
    ["secondaryColor", "--theme-secondary"],
    ["buttonColor", "--theme-button"],
    ["cardColor", "--theme-card"],
    ["backgroundColor", "--theme-background"],
    ["accentColor", "--theme-accent"],
  ];
  for (const [key, variable] of variables) {
    const value = resolved[key];
    if (value) root.style.setProperty(variable, value);
  }

  const accent = resolved.accentColor;
  const background = resolved.backgroundColor;
  const card = resolved.cardColor;
  const primary = resolved.primaryColor;

  if (accent) {
    root.style.setProperty("--green-bright", accent);
    root.style.setProperty("--ui-neon", accent);
    root.style.setProperty("--ui-neon-soft", rgba(accent, 0.28));
    root.style.setProperty("--ui-neon-line", "rgba(119, 247, 168, 0.11)");
    root.style.setProperty("--line", "rgba(119, 247, 168, 0.11)");
    root.style.setProperty("--ui-shadow-glow", "0 0 20px rgba(41, 160, 86, 0.12)");
    root.style.setProperty("--ui-muted", "#839a8f");
    root.style.setProperty("--muted", "#839a8f");
  }
  if (background) {
    root.style.setProperty("--ui-bg", background);
    root.style.setProperty("--deep", background);
    root.style.setProperty("--forest", mixHex(background, "#ffffff", 0.04));
    root.style.setProperty("--ui-bg-soft", mixHex(background, "#ffffff", 0.06));
  }
  if (card) {
    root.style.setProperty("--ui-shell", "rgba(5, 17, 11, 0.96)");
    root.style.setProperty("--ui-card-top", "rgba(19, 54, 34, 0.68)");
    root.style.setProperty("--ui-card-bottom", "rgba(6, 26, 16, 0.7)");
    root.style.setProperty("--glass", "rgba(8, 29, 18, 0.72)");
  }
  if (primary) {
    root.style.setProperty("--ui-gold", mixHex(primary, "#ffd54a", 0.35));
  }

  if (resolved.themePreset) {
    root.dataset.themePreset = resolved.themePreset;
  }

  if (background) {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", background);
  }
  if (resolved.siteName) document.title = resolved.siteName;
}

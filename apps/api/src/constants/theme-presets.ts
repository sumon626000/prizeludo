const themePresetsData = {
  presets: [
    {
      id: "forest",
      label: "Forest Green",
      labelBn: "সবুজ বন",
      primaryColor: "#29a056",
      secondaryColor: "#0b3d24",
      buttonColor: "#1d6b3f",
      cardColor: "#081d12",
      backgroundColor: "#07100c",
      accentColor: "#5cdb8b",
    },
    {
      id: "ocean",
      label: "Ocean Blue",
      labelBn: "সমুদ্র নীল",
      primaryColor: "#0ea5e9",
      secondaryColor: "#0c4a6e",
      buttonColor: "#0284c7",
      cardColor: "#082f49",
      backgroundColor: "#020c17",
      accentColor: "#7dd3fc",
    },
    {
      id: "royal",
      label: "Royal Purple",
      labelBn: "রয়্যাল বেগুনি",
      primaryColor: "#a855f7",
      secondaryColor: "#581c87",
      buttonColor: "#9333ea",
      cardColor: "#2e1065",
      backgroundColor: "#0c0414",
      accentColor: "#e9d5ff",
    },
    {
      id: "sunset",
      label: "Sunset Blaze",
      labelBn: "সূর্যাস্ত কমলা",
      primaryColor: "#f97316",
      secondaryColor: "#9a3412",
      buttonColor: "#ea580c",
      cardColor: "#431407",
      backgroundColor: "#140801",
      accentColor: "#fdba74",
    },
    {
      id: "ruby",
      label: "Ruby Red",
      labelBn: "রুবি লাল",
      primaryColor: "#ef4444",
      secondaryColor: "#991b1b",
      buttonColor: "#dc2626",
      cardColor: "#450a0a",
      backgroundColor: "#0f0202",
      accentColor: "#fca5a5",
    },
    {
      id: "gold",
      label: "Golden Crown",
      labelBn: "সোনালি মুকুট",
      primaryColor: "#eab308",
      secondaryColor: "#854d0e",
      buttonColor: "#ca8a04",
      cardColor: "#422006",
      backgroundColor: "#0c0800",
      accentColor: "#fde047",
    },
    {
      id: "midnight",
      label: "Midnight Cyan",
      labelBn: "মিডনাইট সায়ান",
      primaryColor: "#06b6d4",
      secondaryColor: "#155e75",
      buttonColor: "#0891b2",
      cardColor: "#083344",
      backgroundColor: "#020a0f",
      accentColor: "#67e8f9",
    },
  ],
} as const;

export type ThemePresetId = (typeof themePresetsData.presets)[number]["id"];

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

export const THEME_PRESETS = themePresetsData.presets as unknown as ThemePresetColors[];

export const THEME_PRESET_IDS = THEME_PRESETS.map(
  (preset) => preset.id,
) as ThemePresetId[];

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

export function resolveThemePresetSettings(
  values: Record<string, string>,
): Record<string, string> {
  const presetId = values["site.theme_preset"];
  if (!presetId) return values;
  const preset = getThemePreset(presetId);
  if (!preset) return values;
  return {
    ...values,
    ...presetToSettingValues(preset),
  };
}

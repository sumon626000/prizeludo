export const PRESET_AVATAR_COUNT = 20;

export function presetAvatarPath(index: number) {
  return `/avatars/face-${String(index).padStart(2, "0")}.svg`;
}

export const avatarOptions = Array.from(
  { length: PRESET_AVATAR_COUNT },
  (_, index) => presetAvatarPath(index + 1),
);

const legacyForestAvatars = Array.from(
  { length: 8 },
  (_, index) => `/avatars/forest-${String(index + 1).padStart(2, "0")}.svg`,
);

export const validPresetAvatars = [...avatarOptions, ...legacyForestAvatars];

export function defaultPresetAvatar(seed: string) {
  const value = Array.from(seed).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return presetAvatarPath((value % PRESET_AVATAR_COUNT) + 1);
}

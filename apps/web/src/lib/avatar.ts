import { defaultPresetAvatar } from "./avatars";

export function resolvedAvatar(avatar: string | null | undefined, gameId: string) {
  if (avatar && avatar !== "/avatar-leaf.svg") return avatar;
  return defaultPresetAvatar(gameId);
}

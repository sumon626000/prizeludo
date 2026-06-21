import type { User } from "../db/schema.js";

export function toPublicUser(user: User) {
  return {
    id: user.id,
    gameId: user.gameId,
    name: user.name,
    phone: user.phone,
    email: user.email,
    username: user.username,
    avatar: user.avatar,
    mainBalance: user.mainBalance,
    winnerBalance: user.winnerBalance,
    referCode: user.referCode,
    isAdmin: user.isAdmin,
    isSubAdmin: user.isSubAdmin,
    isGuest: user.isGuest,
    adminPermissions: user.adminPermissions,
    isBot: user.isBot,
    createdAt: user.createdAt,
  };
}

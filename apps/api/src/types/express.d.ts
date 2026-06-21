import type { User as DatabaseUser } from "../db/schema.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: DatabaseUser;
      authSessionId?: string;
      deviceId: string;
      clientIp: string;
    }
  }
}

export {};

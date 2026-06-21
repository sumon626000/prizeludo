import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: config.DATABASE_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,
});

export const db = drizzle(pool, { schema });

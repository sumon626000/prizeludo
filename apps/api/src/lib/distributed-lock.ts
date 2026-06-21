import { pool } from "../db/client.js";

export async function withPostgresAdvisoryLock<T>(
  key: number,
  task: () => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [key],
    );
    acquired = result.rows[0]?.locked === true;
    if (!acquired) return { acquired: false };
    return { acquired: true, value: await task() };
  } finally {
    if (acquired) {
      await client.query("select pg_advisory_unlock($1)", [key]);
    }
    client.release();
  }
}

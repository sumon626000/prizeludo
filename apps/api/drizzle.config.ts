import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://khan_ludo:khan_ludo@localhost:5432/khan_ludo",
  },
  strict: true,
  verbose: true,
});

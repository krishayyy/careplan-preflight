import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

/**
 * Next.js reads `.env.local` automatically; standalone tsx scripts do not.
 * `import "dotenv/config"` only reads `.env`, which is why the seed script
 * couldn't see credentials that were sitting in `.env.local` all along.
 *
 * Loads `.env.local` then `.env`, and reports which keys are missing without
 * ever printing a value.
 */
export function loadEnv(): void {
  const root = process.cwd();

  for (const file of [".env.local", ".env"]) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full });
    }
  }
}

/** Fail fast with a readable message. Never prints secret values. */
export function requireEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]?.trim());
  if (missing.length === 0) return;

  console.error("\n❌ missing from .env.local:\n");
  for (const k of missing) console.error(`   ${k}`);
  console.error(
    `\n   file: ${path.join(process.cwd(), ".env.local")}` +
      `\n   check the line has a value after the "=" and the file is saved.\n`
  );
  process.exit(1);
}

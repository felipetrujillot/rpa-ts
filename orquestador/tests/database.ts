import { createPool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
if (!process.env.RPA_TEST_DATABASE_URL)
  throw new Error(
    "Ejecuta npm run test:integration para usar la base desechable.",
  );
export const pool = createPool(process.env.RPA_TEST_DATABASE_URL);
export const db = drizzle(pool);

import {
  index,
  int,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const assets = mysqlTable(
  "assets",
  {
    id: varchar("id", { length: 36 }).notNull().primaryKey(),
    uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
    original_name: varchar("original_name", { length: 255 }).notNull(),
    content_type: varchar("content_type", { length: 40 }).notNull(),
    byte_length: int("byte_length").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    width: int("width").notNull(),
    height: int("height").notNull(),
    storage_provider: varchar("storage_provider", { length: 40 }).notNull(),
    storage_key: varchar("storage_key", { length: 255 }).notNull(),
    created_by: varchar("created_by", { length: 255 }).notNull(),
    created_at: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
  },
  (table) => [index("assets_tenant_id_idx").on(table.uuid_empresa, table.id)],
);

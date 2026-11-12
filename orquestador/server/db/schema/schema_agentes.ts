import {
  bigint,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const agentes = mysqlTable("agentes", {
  uuid_agente: varchar("uuid_agente", { length: 255 }).notNull().primaryKey(),
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  // Vinculación
  codigo_vinculacion: varchar("codigo_vinculacion", { length: 255 }).unique(),
  codigo_vinculacion_expira: timestamp("codigo_vinculacion_expira"),
  session_id: varchar("session_id", { length: 36 }),
  refresh_token_hash: varchar("refresh_token_hash", { length: 64 }),
  refresh_token_expira: timestamp("refresh_token_expira"),
  // Estado
  estado: mysqlEnum("estado", [
    "pendiente",
    "online",
    "offline",
    "ejecutando",
    "desconectado",
    "desvinculado",
    "revocado",
  ])
    .notNull()
    .default("pendiente"),
  ultimo_ping: timestamp("ultimo_ping"),
  // Información del equipo
  hostname: varchar("hostname", { length: 255 }),
  sistema_operativo: varchar("sistema_operativo", { length: 100 }),
  sistema_operativo_version: varchar("sistema_operativo_version", {
    length: 100,
  }),
  arquitectura: varchar("arquitectura", { length: 50 }),
  // Hardware
  cpu: varchar("cpu", { length: 255 }),
  cpu_nucleos: int("cpu_nucleos"),
  memoria_total: bigint("memoria_total", {
    mode: "number",
  }),
  // Información del agente
  version_electron: varchar("version_electron", { length: 50 }),
  plugin_inventory_json: json("plugin_inventory_json").$type<import("@rpa/contracts").PluginInventory>(),
  script_allowed_actions_json: json("script_allowed_actions_json").$type<string[]>(),
  // Auditoría
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

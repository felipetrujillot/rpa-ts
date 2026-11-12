import {
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const flujos = mysqlTable("flujos", {
  uuid_flujo: varchar("uuid_flujo", { length: 255 }).notNull().primaryKey(),
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  estado_publicacion: mysqlEnum("estado_publicacion", [
    "draft",
    "published",
    "archived",
  ])
    .notNull()
    .default("draft"),
  schema_version_actual: varchar("schema_version_actual", { length: 20 }),
  version_publicada: int("version_publicada").default(0).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const flowVersions = mysqlTable("flow_versions", {
  uuid_flow_version: varchar("uuid_flow_version", { length: 255 })
    .notNull()
    .primaryKey(),
  uuid_flujo: varchar("uuid_flujo", { length: 255 }).notNull(),
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
  version_number: int("version_number").notNull(),
  schema_version: varchar("schema_version", { length: 20 }).notNull(),
  estado: mysqlEnum("estado", ["draft", "published", "archived"])
    .notNull()
    .default("draft"),
  checksum: varchar("checksum", { length: 128 }).notNull(),
  definition_json: json("definition_json").notNull(),
  created_by: varchar("created_by", { length: 255 }),
  published_at: timestamp("published_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const flowRuns = mysqlTable("flow_runs", {
  uuid_flow_run: varchar("uuid_flow_run", { length: 255 })
    .notNull()
    .primaryKey(),
  uuid_flujo: varchar("uuid_flujo", { length: 255 }).notNull(),
  uuid_flow_version: varchar("uuid_flow_version", { length: 255 }).notNull(),
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
  uuid_agente: varchar("uuid_agente", { length: 255 }),
  uuid_agente_flujo: varchar("uuid_agente_flujo", { length: 255 }),
  trigger_type: varchar("trigger_type", { length: 40 }).notNull(),
  status: mysqlEnum("status", [
    "queued",
    "running",
    "cancelling",
    "success",
    "failed",
    "cancelled",
  ])
    .notNull()
    .default("queued"),
  input_json: json("input_json"),
  output_json: json("output_json"),
  error_summary: varchar("error_summary", { length: 500 }),
  telemetry_deleted_at: timestamp("telemetry_deleted_at", { fsp: 3 }),
  started_at: timestamp("started_at"),
  finished_at: timestamp("finished_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const agenteFlujos = mysqlTable("agente_flujos", {
  uuid_agente_flujo: varchar("uuid_agente_flujo", { length: 255 })
    .notNull()
    .primaryKey(),
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
  uuid_agente: varchar("uuid_agente", { length: 255 }).notNull(),
  uuid_flujo: varchar("uuid_flujo", { length: 255 }).notNull(),
  uuid_flow_version: varchar("uuid_flow_version", { length: 255 }),
  cron_expression: varchar("cron_expression", { length: 120 }),
  schedule_timezone: varchar("schedule_timezone", { length: 100 }).notNull().default("America/Santiago"),
  next_scheduled_at: timestamp("next_scheduled_at", { fsp: 3 }),
  scheduling_error: varchar("scheduling_error", { length: 500 }),
  activo: int("activo").notNull().default(1),
  created_by: varchar("created_by", { length: 255 }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const flowNodeRuns = mysqlTable(
  "node_runs",
  {
    uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
    command_id: varchar("command_id", { length: 36 }).notNull(),
    execution_index: int("execution_index").notNull(),
    uuid_node_run: varchar("uuid_node_run", { length: 255 })
      .notNull()
      .primaryKey(),
    uuid_flow_run: varchar("uuid_flow_run", { length: 255 }).notNull(),
    node_id: varchar("node_id", { length: 255 }).notNull(),
    node_type: varchar("node_type", { length: 30 }).notNull(),
    status: mysqlEnum("status", ["running", "success", "failed"]).notNull(),
    node_name: varchar("node_name", { length: 255 }).notNull(),
    output_index: int("output_index").notNull().default(0),
    output_json: json("output_json"),
    error_message: varchar("error_message", { length: 500 }),
    error_json: json("error_json"),
    started_at: timestamp("started_at"),
    finished_at: timestamp("finished_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("node_runs_execution_unique").on(
      table.uuid_flow_run,
      table.execution_index,
    ),
    index("node_runs_tenant_run_idx").on(
      table.uuid_empresa,
      table.uuid_flow_run,
    ),
  ],
);

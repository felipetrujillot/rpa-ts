import {
  mysqlTable,
  varchar,
  timestamp,
  json,
  int,
  longtext,
  index,
} from "drizzle-orm/mysql-core";
export const runTelemetryReceipts = mysqlTable(
  "run_telemetry_receipts",
  {
    event_id: varchar("event_id", { length: 36 }).primaryKey(),
    uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
    uuid_flow_run: varchar("uuid_flow_run", { length: 255 }).notNull(),
    command_id: varchar("command_id", { length: 36 }).notNull(),
    created_at: timestamp("created_at", { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index("telemetry_run_idx").on(table.uuid_empresa, table.uuid_flow_run),
  ],
);
export const runArtifacts = mysqlTable(
  "run_artifacts",
  {
    artifact_id: varchar("artifact_id", { length: 36 }).primaryKey(),
    uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
    uuid_flow_run: varchar("uuid_flow_run", { length: 255 }).notNull(),
    command_id: varchar("command_id", { length: 36 }).notNull(),
    content_type: varchar("content_type", { length: 30 }).notNull(),
    byte_length: int("byte_length").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content_base64: longtext("content_base64").notNull(),
    created_at: timestamp("created_at", { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index("artifacts_run_idx").on(table.uuid_empresa, table.uuid_flow_run),
  ],
);
export const executionAudit = mysqlTable(
  "execution_audit",
  {
    audit_id: varchar("audit_id", { length: 36 }).primaryKey(),
    uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
    actor_type: varchar("actor_type", { length: 20 }).notNull(),
    actor_id: varchar("actor_id", { length: 255 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    resource_id: varchar("resource_id", { length: 255 }).notNull(),
    details: json("details"),
    created_at: timestamp("created_at", { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index("execution_audit_tenant_time_idx").on(
      table.uuid_empresa,
      table.created_at,
    ),
  ],
);

export const tenantRetentionPolicies = mysqlTable("tenant_retention_policies", {
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).primaryKey(),
  evidence_days: int("evidence_days").notNull().default(30),
  audit_days: int("audit_days").notNull().default(90),
  updated_at: timestamp("updated_at", { fsp: 3 }).notNull().defaultNow(),
});

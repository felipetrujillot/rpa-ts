ALTER TABLE flow_runs ADD COLUMN telemetry_deleted_at timestamp(3) NULL;
--> statement-breakpoint
-- The previous table had no live writer. Remove unscoped development traces before enforcing tenant identity.
DELETE FROM node_runs;
--> statement-breakpoint
ALTER TABLE node_runs ADD COLUMN uuid_empresa varchar(255) NOT NULL, ADD COLUMN command_id varchar(36) NOT NULL, ADD COLUMN execution_index int NOT NULL, ADD COLUMN error_json json, MODIFY started_at timestamp(3) NULL, MODIFY finished_at timestamp(3) NULL, MODIFY status enum('running','success','failed') NOT NULL, ADD UNIQUE KEY node_runs_execution_unique (uuid_flow_run, execution_index), ADD KEY node_runs_tenant_run_idx (uuid_empresa, uuid_flow_run);
--> statement-breakpoint
CREATE TABLE run_telemetry_receipts (
 event_id varchar(36) PRIMARY KEY, uuid_empresa varchar(255) NOT NULL, uuid_flow_run varchar(255) NOT NULL,
 command_id varchar(36) NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY telemetry_run_idx (uuid_empresa, uuid_flow_run)
);
--> statement-breakpoint
CREATE TABLE run_artifacts (
 artifact_id varchar(36) PRIMARY KEY, uuid_empresa varchar(255) NOT NULL, uuid_flow_run varchar(255) NOT NULL,
 command_id varchar(36) NOT NULL, content_type varchar(30) NOT NULL, byte_length int NOT NULL,
 sha256 varchar(64) NOT NULL, content_base64 longtext NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY artifacts_run_idx (uuid_empresa, uuid_flow_run)
);
--> statement-breakpoint
CREATE TABLE execution_audit (
 audit_id varchar(36) PRIMARY KEY, uuid_empresa varchar(255) NOT NULL, actor_type varchar(20) NOT NULL,
 actor_id varchar(255) NOT NULL, action varchar(80) NOT NULL, resource_id varchar(255) NOT NULL,
 details json, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY execution_audit_tenant_time_idx (uuid_empresa, created_at)
);
--> statement-breakpoint
CREATE TABLE tenant_retention_policies (
 uuid_empresa varchar(255) PRIMARY KEY, evidence_days int NOT NULL DEFAULT 30, audit_days int NOT NULL DEFAULT 90,
 updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

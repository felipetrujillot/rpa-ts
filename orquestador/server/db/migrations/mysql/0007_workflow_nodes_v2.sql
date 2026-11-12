-- Apply with all workers stopped. Recreate workflows using the v2 designer.
UPDATE flow_versions SET estado = 'archived' WHERE schema_version <> '2.0.0';
--> statement-breakpoint
UPDATE flujos SET estado_publicacion = 'draft', version_publicada = 0, schema_version_actual = '2.0.0' WHERE schema_version_actual IS NULL OR schema_version_actual <> '2.0.0';
--> statement-breakpoint
UPDATE flow_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_summary = 'Cambio de contrato v2: revisar efectos y recrear el workflow.' WHERE status IN ('queued','running','cancelling');
--> statement-breakpoint
UPDATE agent_commands SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE status <> 'completed';
--> statement-breakpoint
UPDATE agent_reservations SET requires_reconciliation = 1 WHERE uuid_flow_run IS NOT NULL;
--> statement-breakpoint
RENAME TABLE step_runs TO node_runs;
--> statement-breakpoint
ALTER TABLE node_runs CHANGE uuid_step_run uuid_node_run varchar(255) NOT NULL, CHANGE step_id node_id varchar(255) NOT NULL, CHANGE step_kind node_type varchar(30) NOT NULL, DROP COLUMN attempt, ADD COLUMN node_name varchar(255) NOT NULL DEFAULT '', ADD COLUMN output_index int NOT NULL DEFAULT 0;

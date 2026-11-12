ALTER TABLE `agentes`
ADD COLUMN `session_id` varchar(36),
ADD COLUMN `refresh_token_hash` varchar(64),
ADD COLUMN `refresh_token_expira` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `flow_runs`
MODIFY COLUMN `status` enum('queued','running','cancelling','success','failed','cancelled') NOT NULL DEFAULT 'queued';
--> statement-breakpoint
-- Existing robot credentials are intentionally invalidated. Generate a fresh pairing code.
UPDATE `agentes` SET `estado` = 'desvinculado', `codigo_vinculacion` = NULL,
`codigo_vinculacion_expira` = NULL WHERE `session_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `agentes_codigo_vinculacion_unique` ON `agentes` (`codigo_vinculacion`);

--> statement-breakpoint
-- Old sessions cannot acknowledge completion after the credential migration.
UPDATE `flow_runs` SET `status` = 'failed', `finished_at` = CURRENT_TIMESTAMP,
`updated_at` = CURRENT_TIMESTAMP, `error_summary` = 'Sesión de agente invalidada por actualización; revisar efectos antes de reintentar.'
WHERE `status` IN ('running', 'cancelling');

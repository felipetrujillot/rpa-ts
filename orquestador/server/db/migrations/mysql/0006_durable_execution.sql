CREATE TABLE `agent_reservations` (
  `uuid_agente` varchar(255) NOT NULL PRIMARY KEY,
  `uuid_empresa` varchar(255) NOT NULL,
  `uuid_flow_run` varchar(255),
  `lease_token` varchar(36),
  `requires_reconciliation` int NOT NULL DEFAULT 0,
  `lease_expires_at` timestamp(3) NULL
);
--> statement-breakpoint
CREATE TABLE `agent_commands` (
  `command_id` varchar(36) NOT NULL PRIMARY KEY,
  `uuid_empresa` varchar(255) NOT NULL,
  `uuid_agente` varchar(255) NOT NULL,
  `uuid_flow_run` varchar(255) NOT NULL,
  `kind` enum('run_flow','cancel_flow') NOT NULL,
  `lease_token` varchar(36) NOT NULL,
  `payload` json NOT NULL,
  `status` enum('pending','accepted','completed') NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT 0,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `accepted_at` timestamp(3) NULL,
  `completed_at` timestamp(3) NULL,
  UNIQUE KEY `agent_commands_run_kind_unique` (`uuid_flow_run`, `kind`),
  KEY `agent_commands_delivery` (`uuid_empresa`, `uuid_agente`, `status`)
);
--> statement-breakpoint
-- Upgrade only while workers are stopped; old executions lack fencing tokens.
UPDATE `flow_runs` SET `status` = 'failed', `finished_at` = CURRENT_TIMESTAMP,
`error_summary` = 'Actualización del protocolo: revisar ejecución anterior antes de reintentar.'
WHERE `status` IN ('running', 'cancelling');

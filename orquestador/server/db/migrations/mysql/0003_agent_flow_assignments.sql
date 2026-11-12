ALTER TABLE `flow_runs`
ADD COLUMN `uuid_agente` varchar(255),
ADD COLUMN `uuid_agente_flujo` varchar(255);

--> statement-breakpoint
CREATE TABLE `agente_flujos` (
  `uuid_agente_flujo` varchar(255) NOT NULL,
  `uuid_empresa` varchar(255) NOT NULL,
  `uuid_agente` varchar(255) NOT NULL,
  `uuid_flujo` varchar(255) NOT NULL,
  `uuid_flow_version` varchar(255),
  `cron_expression` varchar(120),
  `activo` int NOT NULL DEFAULT 1,
  `created_by` varchar(255),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `agente_flujos_uuid_agente_flujo` PRIMARY KEY(`uuid_agente_flujo`)
);
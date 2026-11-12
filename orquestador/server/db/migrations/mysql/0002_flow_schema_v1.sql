ALTER TABLE `flujos`
ADD COLUMN `estado_publicacion` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
ADD COLUMN `schema_version_actual` varchar(20),
ADD COLUMN `version_publicada` int NOT NULL DEFAULT 0;

--> statement-breakpoint
CREATE TABLE `flow_versions` (
  `uuid_flow_version` varchar(255) NOT NULL,
  `uuid_flujo` varchar(255) NOT NULL,
  `uuid_empresa` varchar(255) NOT NULL,
  `version_number` int NOT NULL,
  `schema_version` varchar(20) NOT NULL,
  `estado` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
  `checksum` varchar(128) NOT NULL,
  `definition_json` json NOT NULL,
  `created_by` varchar(255),
  `published_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `flow_versions_uuid_flow_version` PRIMARY KEY(`uuid_flow_version`)
);

--> statement-breakpoint
CREATE TABLE `flow_runs` (
  `uuid_flow_run` varchar(255) NOT NULL,
  `uuid_flujo` varchar(255) NOT NULL,
  `uuid_flow_version` varchar(255) NOT NULL,
  `uuid_empresa` varchar(255) NOT NULL,
  `trigger_type` varchar(40) NOT NULL,
  `status` enum('queued','running','success','failed','cancelled') NOT NULL DEFAULT 'queued',
  `input_json` json,
  `output_json` json,
  `error_summary` varchar(500),
  `started_at` timestamp,
  `finished_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `flow_runs_uuid_flow_run` PRIMARY KEY(`uuid_flow_run`)
);

--> statement-breakpoint
CREATE TABLE `step_runs` (
  `uuid_step_run` varchar(255) NOT NULL,
  `uuid_flow_run` varchar(255) NOT NULL,
  `step_id` varchar(255) NOT NULL,
  `step_kind` varchar(30) NOT NULL,
  `status` enum('success','failed') NOT NULL,
  `attempt` int NOT NULL DEFAULT 1,
  `output_json` json,
  `error_message` varchar(500),
  `started_at` timestamp,
  `finished_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `step_runs_uuid_step_run` PRIMARY KEY(`uuid_step_run`)
);

CREATE TABLE `agentes` (
	`uuid_agente` varchar(255) NOT NULL,
	`uuid_empresa` varchar(255) NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`codigo_vinculacion` varchar(255),
	`codigo_vinculacion_expira` timestamp,
	`estado` enum('pendiente','online','offline','ejecutando','desconectado','revocado') NOT NULL DEFAULT 'pendiente',
	`ultimo_ping` timestamp,
	`hostname` varchar(255),
	`sistema_operativo` varchar(100),
	`sistema_operativo_version` varchar(100),
	`arquitectura` varchar(50),
	`cpu` varchar(255),
	`cpu_nucleos` int,
	`memoria_total` bigint,
	`version_electron` varchar(50),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentes_uuid_agente` PRIMARY KEY(`uuid_agente`)
);
--> statement-breakpoint
CREATE TABLE `flujos` (
	`uuid_flujo` varchar(255) NOT NULL,
	`uuid_empresa` varchar(255) NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flujos_uuid_flujo` PRIMARY KEY(`uuid_flujo`)
);

CREATE TABLE `empresas` (
	`uuid_empresa` varchar(255) NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`tipo_pasarela` varchar(30) DEFAULT 'mercadopago',
	`logo_empresa` varchar(255),
	`firma_empresa_png` varchar(500),
	`publickey` varchar(255),
	`accesstoken` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `empresas_uuid_empresa` PRIMARY KEY(`uuid_empresa`)
);
--> statement-breakpoint
CREATE TABLE `passwords_reset` (
	`uuid_password_reset` varchar(255) NOT NULL,
	`token` varchar(250) NOT NULL,
	`id_user` int NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passwords_reset_uuid_password_reset` PRIMARY KEY(`uuid_password_reset`)
);
--> statement-breakpoint
CREATE TABLE `usuarios` (
	`uuid_usuario` varchar(255) NOT NULL,
	`uuid_empresa` varchar(255) NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`role` int NOT NULL,
	`activo` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `usuarios_uuid_usuario` PRIMARY KEY(`uuid_usuario`)
);

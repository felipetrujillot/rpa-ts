CREATE TABLE `assets` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `uuid_empresa` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `content_type` varchar(40) NOT NULL,
  `byte_length` int NOT NULL,
  `sha256` varchar(64) NOT NULL,
  `width` int NOT NULL,
  `height` int NOT NULL,
  `storage_provider` varchar(40) NOT NULL,
  `storage_key` varchar(255) NOT NULL,
  `created_by` varchar(255) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `assets_tenant_id_idx` (`uuid_empresa`, `id`)
);

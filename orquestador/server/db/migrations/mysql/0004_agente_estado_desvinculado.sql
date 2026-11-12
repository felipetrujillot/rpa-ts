ALTER TABLE `agentes`
MODIFY COLUMN `estado` enum('pendiente','online','offline','ejecutando','desconectado','desvinculado','revocado') NOT NULL DEFAULT 'pendiente';
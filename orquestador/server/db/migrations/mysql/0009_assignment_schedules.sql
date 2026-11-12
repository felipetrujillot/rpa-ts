ALTER TABLE `agente_flujos`
  ADD COLUMN `schedule_timezone` varchar(100) NOT NULL DEFAULT 'America/Santiago',
  ADD COLUMN `next_scheduled_at` timestamp(3) NULL,
  ADD COLUMN `scheduling_error` varchar(500) NULL;

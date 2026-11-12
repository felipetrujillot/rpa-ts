import { mysqlTable, varchar, timestamp, json, mysqlEnum, int, uniqueIndex } from 'drizzle-orm/mysql-core';

export const agentReservations = mysqlTable('agent_reservations', {
  uuid_agente: varchar('uuid_agente', { length: 255 }).primaryKey(),
  uuid_empresa: varchar('uuid_empresa', { length: 255 }).notNull(),
  uuid_flow_run: varchar('uuid_flow_run', { length: 255 }),
  requires_reconciliation: int('requires_reconciliation').notNull().default(0),
  lease_token: varchar('lease_token', { length: 36 }),
  lease_expires_at: timestamp('lease_expires_at', { fsp: 3 }),
});
export const agentCommands = mysqlTable('agent_commands', {
  command_id: varchar('command_id', { length: 36 }).primaryKey(),
  uuid_empresa: varchar('uuid_empresa', { length: 255 }).notNull(),
  uuid_agente: varchar('uuid_agente', { length: 255 }).notNull(),
  uuid_flow_run: varchar('uuid_flow_run', { length: 255 }).notNull(),
  kind: mysqlEnum('kind', ['run_flow', 'cancel_flow']).notNull(),
  lease_token: varchar('lease_token', { length: 36 }).notNull(),
  payload: json('payload').notNull(),
  status: mysqlEnum('status', ['pending', 'accepted', 'completed']).notNull().default('pending'),
  attempts: int('attempts').notNull().default(0),
  created_at: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  accepted_at: timestamp('accepted_at', { fsp: 3 }),
  completed_at: timestamp('completed_at', { fsp: 3 }),
}, (table) => [uniqueIndex('agent_commands_run_kind_unique').on(table.uuid_flow_run, table.kind)]);

import { int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
export * from "./schema_agentes";
export * from "./schema_flujos";
export * from "./schema_execution";
export * from "./schema_observability";
export * from "./schema_assets";

/**
 * Definición de tablas para la base de datos MySQL utilizando Drizzle ORM.
 * Incluye las tablas "empresas", "usuarios" y "passwords_reset" con sus respectivos campos y tipos de datos.
 * Cada tabla tiene campos para almacenar información relevante, como UUID, nombres, correos electrónicos, contraseñas, roles, estados de actividad y marcas de tiempo de creación y actualización.
 */
export const empresas = mysqlTable("empresas", {
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull().primaryKey(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  tipo_pasarela: varchar("tipo_pasarela", { length: 30 }).default(
    "mercadopago",
  ),
  logo_empresa: varchar("logo_empresa", { length: 255 }),
  firma_empresa_png: varchar("firma_empresa_png", { length: 500 }),
  publickey: varchar("publickey", { length: 255 }),
  accesstoken: varchar("accesstoken", { length: 255 }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Definición de la tabla "usuarios" para la base de datos MySQL utilizando Drizzle ORM.
 * Esta tabla almacena información sobre los usuarios, incluyendo su UUID, el UUID de la empresa a la que pertenecen, su nombre, correo electrónico, contraseña, rol, estado de actividad y marcas de tiempo de creación y actualización.
 * El campo "uuid_usuario" es la clave primaria de la tabla, mientras que "uuid_empresa" es una clave foránea que hace referencia a la tabla "empresas".
 */
export const usuarios = mysqlTable("usuarios", {
  uuid_usuario: varchar("uuid_usuario", { length: 255 }).notNull().primaryKey(),
  uuid_empresa: varchar("uuid_empresa", { length: 255 }).notNull(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  role: int("role").notNull(),
  activo: int("activo").notNull().default(1),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Definición de la tabla "passwords_reset" para la base de datos MySQL utilizando Drizzle ORM.
 * Esta tabla almacena información sobre las solicitudes de restablecimiento de contraseña, incluyendo un UUID para cada solicitud, un token de restablecimiento, el ID del usuario asociado, un indicador de si la solicitud está activa y marcas de tiempo de creación y actualización.
 * El campo "uuid_password_reset" es la clave primaria de la tabla, mientras que "id_user" es una clave foránea que hace referencia a la tabla "usuarios".
 */
export const passwords_reset = mysqlTable("passwords_reset", {
  uuid_password_reset: varchar("uuid_password_reset", { length: 255 })
    .notNull()
    .primaryKey(),
  token: varchar("token", { length: 250 }).notNull(),
  id_user: int("id_user").notNull(),
  active: int("active").default(1).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

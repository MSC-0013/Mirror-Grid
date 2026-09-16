import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { users } from './core.js';

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
});

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    seqNum: integer('seq_num').notNull().unique(),
    prevHash: text('prev_hash').notNull(),
    recordHash: text('record_hash').notNull().unique(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: text('user_email').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    diffJson: text('diff_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    clientIp: text('client_ip').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_audit_logs_seq').on(table.seqNum),
    index('idx_audit_logs_user').on(table.userId),
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_logs_created').on(table.createdAt),
  ],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  users: many(userRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

import { mysqlTable, varchar, text, bigint, boolean, datetime } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

export const organizations = mysqlTable('organizations', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 64 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const organizationMembers = mysqlTable('organization_members', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: varchar('organization_id', { length: 36 })
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: datetime('joined_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
  lastSeenAt: datetime('last_seen_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
  ipAddress: varchar('ip_address', { length: 255 }),
  userAgent: text('user_agent'),
  isActive: boolean('is_active').notNull().default(true),
});

export const worlds = mysqlTable('worlds', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: varchar('organization_id', { length: 36 })
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 64, enum: [
      'IDLE',
      'CONFIGURING',
      'READY',
      'RUNNING',
      'PAUSED',
      'STOPPING',
      'STOPPED',
      'FAILED',
      'ARCHIVED',
    ] })
    .notNull()
    .default('IDLE'),
  runtimeMode: varchar('runtime_mode', { length: 64, enum: ['LOGICAL', 'CONTAINER', 'HYBRID'] })
    .notNull()
    .default('LOGICAL'),
  eventSeq: bigint('event_seq', { mode: 'bigint', unsigned: true }).notNull().default(0n),
  createdBy: varchar('created_by', { length: 36 })
    .notNull()
    .references(() => users.id),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  worlds: many(worlds),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(organizationMembers),
  sessions: many(sessions),
  createdWorlds: many(worlds),
}));

export const worldsRelations = relations(worlds, ({ one }) => ({
  organization: one(organizations, {
    fields: [worlds.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [worlds.createdBy],
    references: [users.id],
  }),
}));

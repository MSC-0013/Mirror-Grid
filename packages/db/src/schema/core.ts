import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const organizations = sqliteTable('organizations', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const organizationMembers = sqliteTable('organization_members', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: integer('joined_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = sqliteTable('sessions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
});

export const worlds = sqliteTable('worlds', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', {
    enum: [
      'IDLE',
      'CONFIGURING',
      'READY',
      'RUNNING',
      'PAUSED',
      'STOPPING',
      'STOPPED',
      'FAILED',
      'ARCHIVED',
    ],
  })
    .notNull()
    .default('IDLE'),
  runtimeMode: text('runtime_mode', {
    enum: ['LOGICAL', 'CONTAINER', 'HYBRID'],
  })
    .notNull()
    .default('LOGICAL'),
  eventSeq: blob('event_seq', { mode: 'bigint' }).notNull().default(0n),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
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

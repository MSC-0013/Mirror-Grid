import { pgTable, text, timestamp, boolean, uuid, bigint, inet } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  isActive: boolean('is_active').notNull().default(true),
});

export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', {
    enum: ['IDLE', 'CONFIGURING', 'READY', 'RUNNING', 'PAUSED', 'STOPPING', 'STOPPED', 'FAILED', 'ARCHIVED'],
  }).notNull().default('IDLE'),
  runtimeMode: text('runtime_mode', {
    enum: ['LOGICAL', 'CONTAINER', 'HYBRID'],
  }).notNull().default('LOGICAL'),
  eventSeq: bigint('event_seq', { mode: 'bigint' }).notNull().default(0n),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

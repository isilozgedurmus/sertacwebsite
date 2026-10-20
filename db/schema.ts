import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const notebooks = sqliteTable('notebooks', {
  userId: text('user_id').primaryKey(),
  revision: integer('revision').notNull().default(1),
  writeToken: text('write_token').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const notebookRecords = sqliteTable('notebook_records', {
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  recordKey: text('record_key').notNull(),
  payload: text('payload').notNull(),
  modifiedAt: integer('modified_at').notNull().default(0),
  modifiedBy: text('modified_by').notNull().default(''),
}, table => [primaryKey({ columns: [table.userId, table.kind, table.recordKey] })]);

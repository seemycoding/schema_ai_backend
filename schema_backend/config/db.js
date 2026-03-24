"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
// src/config/db.ts
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const pool = new pg_1.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432', 10),
});
exports.pool = pool;
// Test the database connection
pool.connect()
    .then(async (client) => {
    console.log('Connected to PostgreSQL database');
    try {
        await client.query(`
        CREATE TABLE IF NOT EXISTS SchemaShares (
          id SERIAL PRIMARY KEY,
          schema_id INTEGER NOT NULL REFERENCES Schemas(id) ON DELETE CASCADE,
          shared_by_user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
          shared_with_user_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,
          shared_with_email VARCHAR(255),
          permission VARCHAR(16) NOT NULL CHECK (permission IN ('view', 'edit')),
          room_id VARCHAR(255),
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
        await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_schemashares_user
        ON SchemaShares(schema_id, shared_with_user_id)
        WHERE shared_with_user_id IS NOT NULL;
      `);
        await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_schemashares_email
        ON SchemaShares(schema_id, shared_with_email)
        WHERE shared_with_email IS NOT NULL;
      `);
        await client.query(`
        CREATE TABLE IF NOT EXISTS SchemaChatMessages (
          id BIGSERIAL PRIMARY KEY,
          schema_id INTEGER NOT NULL REFERENCES Schemas(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES Users(id) ON DELETE SET NULL,
          role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'system')),
          content TEXT NOT NULL,
          client_message_id VARCHAR(128),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
        await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_schema_chat_client_message
        ON SchemaChatMessages(schema_id, client_message_id);
      `);
        await client.query(`
        CREATE INDEX IF NOT EXISTS idx_schema_chat_schema_created
        ON SchemaChatMessages(schema_id, created_at DESC, id DESC);
      `);
        await client.query(`
        ALTER TABLE Plans
        ADD COLUMN IF NOT EXISTS max_memory_messages INTEGER;
      `);
        await client.query(`
        ALTER TABLE Plans
        ADD COLUMN IF NOT EXISTS context_window_messages INTEGER;
      `);
        await client.query(`
        ALTER TABLE Plans
        ADD COLUMN IF NOT EXISTS max_collaborators_per_diagram INTEGER;
      `);
        await client.query(`
        ALTER TABLE Plans
        ADD COLUMN IF NOT EXISTS version_retention_days INTEGER;
      `);
        await client.query(`
        UPDATE Plans
        SET
          max_memory_messages = CASE WHEN max_memory_messages IS NULL THEN CASE WHEN price > 0 THEN 200 ELSE 20 END ELSE max_memory_messages END,
          context_window_messages = CASE WHEN context_window_messages IS NULL THEN CASE WHEN price > 0 THEN 80 ELSE 12 END ELSE context_window_messages END,
          max_collaborators_per_diagram = CASE
            WHEN max_collaborators_per_diagram IS NULL THEN
              CASE
                WHEN lower(coalesce(name, '')) LIKE '%enterprise%' OR lower(coalesce(name, '')) LIKE '%custom%' OR lower(coalesce(name, '')) LIKE '%team%' THEN NULL
                WHEN price > 0 THEN 5
                ELSE 0
              END
            ELSE max_collaborators_per_diagram
          END,
          version_retention_days = CASE
            WHEN version_retention_days IS NULL THEN
              CASE
                WHEN lower(coalesce(name, '')) LIKE '%enterprise%' OR lower(coalesce(name, '')) LIKE '%custom%' OR lower(coalesce(name, '')) LIKE '%team%' THEN NULL
                WHEN price > 0 THEN 7
                ELSE 0
              END
            ELSE version_retention_days
          END
        WHERE max_memory_messages IS NULL
           OR context_window_messages IS NULL
           OR max_collaborators_per_diagram IS NULL
           OR version_retention_days IS NULL;
      `);
        await client.query(`
        CREATE TABLE IF NOT EXISTS PasswordResetTokens (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
          token_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          used_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
        await client.query(`
        CREATE INDEX IF NOT EXISTS idx_password_reset_user
        ON PasswordResetTokens(user_id, created_at DESC);
      `);
    }
    finally {
        client.release();
    }
})
    .catch(err => {
    console.error('Error connecting to PostgreSQL database:', err.message);
    process.exit(1); // Exit process if cannot connect to DB
});

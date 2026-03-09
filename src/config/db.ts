// src/config/db.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

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
        UPDATE Plans
        SET
          max_memory_messages = CASE WHEN max_memory_messages IS NULL THEN CASE WHEN price > 0 THEN 200 ELSE 20 END ELSE max_memory_messages END,
          context_window_messages = CASE WHEN context_window_messages IS NULL THEN CASE WHEN price > 0 THEN 80 ELSE 12 END ELSE context_window_messages END
        WHERE max_memory_messages IS NULL
           OR context_window_messages IS NULL;
      `);
    } finally {
      client.release();
    }
  })
  .catch(err => {
    console.error('Error connecting to PostgreSQL database:', err.message);
    process.exit(1); // Exit process if cannot connect to DB
  });

export { pool };

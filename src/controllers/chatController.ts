import { Request, Response } from 'express';
import { pool } from '../config/db';
import { getPlanFeaturesForUser } from '../utils/planFeatures';

interface ChatMessageRow {
  id: string;
  schema_id: number;
  user_id: number | null;
  role: 'user' | 'system';
  content: string;
  client_message_id: string | null;
  created_at: string;
}

const getSchemaAccess = async (
  schemaId: number,
  userId: number,
  userEmail: string
): Promise<{ canView: boolean; canEdit: boolean }> => {
  const schemaResult = await pool.query<{ user_id: number }>(
    'SELECT user_id FROM Schemas WHERE id = $1',
    [schemaId]
  );

  if (!schemaResult.rows.length) {
    return { canView: false, canEdit: false };
  }

  const ownerId = schemaResult.rows[0].user_id;
  if (ownerId === userId) {
    return { canView: true, canEdit: true };
  }

  const shareResult = await pool.query<{ permission: 'view' | 'edit' }>(
    `SELECT permission
     FROM SchemaShares
     WHERE schema_id = $1
       AND (shared_with_user_id = $2 OR lower(coalesce(shared_with_email, '')) = $3)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [schemaId, userId, userEmail]
  );

  if (!shareResult.rows.length) {
    return { canView: false, canEdit: false };
  }

  const permission = shareResult.rows[0].permission;
  return { canView: true, canEdit: permission === 'edit' };
};

export const getSchemaChatHistory = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const userEmail = req.user?.email?.toLowerCase();
  const schemaId = Number(req.params.id);

  if (!userId || !userEmail) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  if (!schemaId) {
    return res.status(400).json({ message: 'schema id is required.' });
  }

  try {
    const access = await getSchemaAccess(schemaId, userId, userEmail);
    if (!access.canView) {
      return res.status(403).json({ message: 'You do not have access to this schema chat history.' });
    }

    const plan = await getPlanFeaturesForUser(userId, req.user?.plan_id);
    const memoryLimit = plan.max_memory_messages;

    const result = await pool.query<ChatMessageRow>(
      `SELECT *
       FROM (
         SELECT
           id::text,
           schema_id,
           user_id,
           role,
           content,
           client_message_id,
           created_at
         FROM SchemaChatMessages
         WHERE schema_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [schemaId, memoryLimit]
    );

    return res.status(200).json({
      messages: result.rows.map((row) => ({
        id: row.client_message_id || `db-${row.id}`,
        type: row.role,
        content: row.content,
        timestamp: new Date(row.created_at).getTime(),
        userId: row.user_id || undefined,
      })),
      memory: {
        limit: memoryLimit,
        context_window: plan.context_window_messages,
        plan_name: plan.plan_name,
        is_paid: plan.is_paid,
      },
    });
  } catch (error: any) {
    console.error('Error fetching schema chat history:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const upsertSchemaChatMessage = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const userEmail = req.user?.email?.toLowerCase();
  const schemaId = Number(req.params.id);
  const {
    role,
    content,
    client_message_id,
    timestamp,
  }: {
    role?: 'user' | 'system';
    content?: string;
    client_message_id?: string;
    timestamp?: number;
  } = req.body || {};

  if (!userId || !userEmail) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  if (!schemaId) {
    return res.status(400).json({ message: 'schema id is required.' });
  }

  if (!role || !content?.trim()) {
    return res.status(400).json({ message: 'role and content are required.' });
  }

  if (role !== 'user' && role !== 'system') {
    return res.status(400).json({ message: 'role must be either "user" or "system".' });
  }

  const trimmedContent = content.trim();
  const createdAt = timestamp ? new Date(timestamp) : new Date();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const access = await getSchemaAccess(schemaId, userId, userEmail);
    if (!access.canEdit) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'You do not have permission to update chat history.' });
    }

    const plan = await getPlanFeaturesForUser(userId, req.user?.plan_id);
    const memoryLimit = plan.max_memory_messages;

    const upsertResult = await client.query<ChatMessageRow>(
      `INSERT INTO SchemaChatMessages (schema_id, user_id, role, content, client_message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (schema_id, client_message_id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         role = EXCLUDED.role,
         content = EXCLUDED.content,
         created_at = EXCLUDED.created_at
       RETURNING id::text, schema_id, user_id, role, content, client_message_id, created_at`,
      [schemaId, userId, role, trimmedContent, client_message_id || null, createdAt]
    );

    await client.query(
      `DELETE FROM SchemaChatMessages
       WHERE schema_id = $1
         AND id NOT IN (
           SELECT id
           FROM SchemaChatMessages
           WHERE schema_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2
         )`,
      [schemaId, memoryLimit]
    );

    await client.query('COMMIT');

    const row = upsertResult.rows[0];
    return res.status(200).json({
      message: 'Chat message saved.',
      chat_message: {
        id: row.client_message_id || `db-${row.id}`,
        type: row.role,
        content: row.content,
        timestamp: new Date(row.created_at).getTime(),
        userId: row.user_id || undefined,
      },
      memory: {
        limit: memoryLimit,
        context_window: plan.context_window_messages,
        plan_name: plan.plan_name,
        is_paid: plan.is_paid,
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error saving schema chat message:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    client.release();
  }
};

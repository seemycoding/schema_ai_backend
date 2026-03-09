import { Request, Response } from 'express';
import { pool } from '../config/db';
import {
  Schema,
  SchemaVersion,
  NewSchemaPayload,
  FetchedSchema,
} from '../interface/SchemaInterface';
import { getPlanFeaturesForUser } from '../utils/planFeatures';

interface SchemaCountRow {
  count: string;
}
interface VersionNumberRow {
  next_version: string;
}
interface SchemaVersionListRow {
  id: number;
  schema_id: number;
  version_number: number;
  notes: string | null;
  created_at: Date;
  created_by_user_id: number;
}

const parseSchemaJson = (schemaJson: string) => {
  try {
    JSON.parse(schemaJson);
    return true;
  } catch {
    return false;
  }
};

const normalizeSchemaJson = (schemaJson: string) => {
  try {
    return JSON.stringify(JSON.parse(schemaJson));
  } catch {
    return schemaJson.trim();
  }
};

export const saveSchema = async (
  req: Request<{}, {}, NewSchemaPayload>,
  res: Response
) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const { name, description, prompt_text, schema_json, team_id } = req.body;

  if (!name || !prompt_text || !schema_json) {
    return res
      .status(400)
      .json({ message: 'Schema name, prompt text, and schema JSON are required.' });
  }

  if (!parseSchemaJson(schema_json)) {
    return res
      .status(400)
      .json({ message: 'Invalid schema_json format. Must be a valid JSON string.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const plan = await getPlanFeaturesForUser(userId, req.user?.plan_id);
    const usageResult = await client.query<SchemaCountRow>(
      'SELECT COUNT(*)::text AS count FROM Schemas WHERE user_id = $1',
      [userId]
    );

    const usedDiagrams = Number(usageResult.rows[0]?.count || '0');

    if (plan.max_diagrams !== null && usedDiagrams >= plan.max_diagrams) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        code: 'DIAGRAM_LIMIT_REACHED',
        message: `You have reached your diagram limit (${plan.max_diagrams}) for the ${plan.plan_name} plan.`,
        usage: {
          used_diagrams: usedDiagrams,
          max_diagrams: plan.max_diagrams,
          has_collaboration: plan.has_collaboration,
          plan_name: plan.plan_name,
        },
      });
    }

    const newSchemaResult = await client.query<Schema>(
      `INSERT INTO Schemas (user_id, team_id, name, description, prompt_text, created_at, updated_at, current_version_id)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NULL)
       RETURNING id, user_id, team_id, name, description, prompt_text, created_at, updated_at, current_version_id`,
      [userId, team_id || null, name, description || null, prompt_text]
    );
    const newSchema = newSchemaResult.rows[0];

    const newSchemaVersionResult = await client.query<SchemaVersion>(
      `INSERT INTO SchemaVersions (schema_id, version_number, schema_json, notes, created_at, created_by_user_id)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       RETURNING id, schema_id, version_number, schema_json, notes, created_at, created_by_user_id`,
      [newSchema.id, 1, schema_json, 'Initial version created upon schema save', userId]
    );
    const newVersion = newSchemaVersionResult.rows[0];

    await client.query(
      'UPDATE Schemas SET current_version_id = $1, updated_at = NOW() WHERE id = $2',
      [newVersion.id, newSchema.id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Schema and initial version saved successfully!',
      schema: {
        ...newSchema,
        current_version_id: newVersion.id,
      },
      current_version_details: newVersion,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error saving new schema and version:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    client.release();
  }
};

export const getSchemas = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const schemasResult = await pool.query<FetchedSchema>(
      `SELECT
        s.id,
        s.user_id,
        s.team_id,
        s.name,
        s.description,
        s.prompt_text,
        s.created_at,
        s.updated_at,
        s.current_version_id,
        sv.schema_json AS current_schema_json
      FROM Schemas s
      LEFT JOIN SchemaVersions sv ON s.current_version_id = sv.id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC`,
      [userId]
    );

    return res.status(200).json({
      message: 'Schemas fetched successfully!',
      schemas: schemasResult.rows,
    });
  } catch (error: any) {
    console.error('Error fetching schemas:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getSchemaUsage = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const [plan, usageResult] = await Promise.all([
      getPlanFeaturesForUser(userId, req.user?.plan_id),
      pool.query<SchemaCountRow>('SELECT COUNT(*)::text AS count FROM Schemas WHERE user_id = $1', [userId]),
    ]);

    const usedDiagrams = Number(usageResult.rows[0]?.count || '0');

    return res.status(200).json({
      usage: {
        used_diagrams: usedDiagrams,
        max_diagrams: plan.max_diagrams,
      },
      plan,
    });
  } catch (error: any) {
    console.error('Error fetching schema usage:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const updateSchema = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const userEmail = req.user?.email?.toLowerCase();
  const schemaId = Number(req.params.id);

  if (!userId || !userEmail) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const { name, description, prompt_text, schema_json, version_note } = req.body as {
    name?: string;
    description?: string;
    prompt_text?: string;
    schema_json?: string;
    version_note?: string;
  };

  if (
    name === undefined &&
    description === undefined &&
    prompt_text === undefined &&
    schema_json === undefined
  ) {
    return res.status(400).json({
      message: 'At least one field (name, description, prompt_text, schema_json) is required for update.',
    });
  }

  if (schema_json !== undefined && !parseSchemaJson(schema_json)) {
    return res
      .status(400)
      .json({ message: 'Invalid schema_json format. Must be a valid JSON string.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const schemaResult = await client.query<Schema>(
      'SELECT id, user_id, current_version_id FROM Schemas WHERE id = $1',
      [schemaId]
    );

    if (schemaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Schema not found.' });
    }

    const schema = schemaResult.rows[0];

    if (schema.user_id !== userId) {
      const shareAccessResult = await client.query<{ permission: 'view' | 'edit' }>(
        `SELECT permission
         FROM SchemaShares
         WHERE schema_id = $1
           AND (shared_with_user_id = $2 OR lower(coalesce(shared_with_email, '')) = $3)
         ORDER BY updated_at DESC
         LIMIT 1`,
        [schemaId, userId, userEmail]
      );

      const permission = shareAccessResult.rows[0]?.permission;
      if (permission !== 'edit') {
        await client.query('ROLLBACK');
        return res
          .status(403)
          .json({ message: 'You do not have permission to update this schema.' });
      }
    }

    const schemaFields: string[] = [];
    const schemaValues: any[] = [];
    let schemaParam = 1;

    if (name !== undefined) {
      schemaFields.push(`name = $${schemaParam++}`);
      schemaValues.push(name);
    }
    if (description !== undefined) {
      schemaFields.push(`description = $${schemaParam++}`);
      schemaValues.push(description);
    }
    if (prompt_text !== undefined) {
      schemaFields.push(`prompt_text = $${schemaParam++}`);
      schemaValues.push(prompt_text);
    }

    if (schemaFields.length > 0) {
      schemaValues.push(schemaId);
      await client.query(
        `UPDATE Schemas
         SET ${schemaFields.join(', ')}, updated_at = NOW()
         WHERE id = $${schemaParam}`,
        schemaValues
      );
    }

    let createdNewVersion = false;
    if (schema_json !== undefined) {
      const normalizedIncoming = normalizeSchemaJson(schema_json);
      let normalizedCurrent = '';

      if (schema.current_version_id) {
        const currentVersionResult = await client.query<{ schema_json: string }>(
          'SELECT schema_json FROM SchemaVersions WHERE id = $1',
          [schema.current_version_id]
        );
        normalizedCurrent = normalizeSchemaJson(currentVersionResult.rows[0]?.schema_json || '');
      }

      const hasSchemaChanged = !schema.current_version_id || normalizedIncoming !== normalizedCurrent;

      if (hasSchemaChanged) {
        const nextVersionResult = await client.query<VersionNumberRow>(
          `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
           FROM SchemaVersions
           WHERE schema_id = $1`,
          [schemaId]
        );
        const nextVersion = Number(nextVersionResult.rows[0]?.next_version || '1');
        const versionNotes =
          typeof version_note === 'string' && version_note.trim()
            ? version_note.trim()
            : 'Updated from builder';

        const createVersionResult = await client.query<SchemaVersion>(
          `INSERT INTO SchemaVersions (schema_id, version_number, schema_json, notes, created_at, created_by_user_id)
           VALUES ($1, $2, $3, $4, NOW(), $5)
           RETURNING id`,
          [schemaId, nextVersion, schema_json, versionNotes, userId]
        );

        await client.query(
          'UPDATE Schemas SET current_version_id = $1, updated_at = NOW() WHERE id = $2',
          [createVersionResult.rows[0].id, schemaId]
        );
        createdNewVersion = true;
      }
    }

    const updatedSchemaResult = await client.query<Schema>(
      `SELECT id, user_id, team_id, name, description, prompt_text, created_at, updated_at, current_version_id
       FROM Schemas
       WHERE id = $1`,
      [schemaId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Schema updated successfully!',
      schema: updatedSchemaResult.rows[0],
      version_created: createdNewVersion,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error updating schema:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    client.release();
  }
};

export const getSchemaVersions = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const schemaId = Number(req.params.id);

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  if (!schemaId) {
    return res.status(400).json({ message: 'Invalid schema id.' });
  }

  try {
    const plan = await getPlanFeaturesForUser(userId, req.user?.plan_id);
    if (!plan.has_version_history) {
      return res.status(403).json({ message: 'Diagram versions are available on paid plans only.' });
    }

    const schemaResult = await pool.query<{ id: number; user_id: number; name: string }>(
      'SELECT id, user_id, name FROM Schemas WHERE id = $1',
      [schemaId]
    );

    if (!schemaResult.rows.length) {
      return res.status(404).json({ message: 'Schema not found.' });
    }

    if (schemaResult.rows[0].user_id !== userId) {
      return res.status(403).json({ message: 'You can only view versions of your own diagrams.' });
    }

    const versionsResult = await pool.query<SchemaVersionListRow>(
      `SELECT id, schema_id, version_number, notes, created_at, created_by_user_id
       FROM SchemaVersions
       WHERE schema_id = $1
       ORDER BY version_number ASC`,
      [schemaId]
    );

    return res.status(200).json({
      schema: schemaResult.rows[0],
      versions: versionsResult.rows,
    });
  } catch (error: any) {
    console.error('Error fetching schema versions:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const getSchemaVersionDetails = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const schemaId = Number(req.params.id);
  const versionId = Number(req.params.versionId);

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  if (!schemaId || !versionId) {
    return res.status(400).json({ message: 'Invalid schema/version id.' });
  }

  try {
    const plan = await getPlanFeaturesForUser(userId, req.user?.plan_id);
    if (!plan.has_version_history) {
      return res.status(403).json({ message: 'Diagram versions are available on paid plans only.' });
    }

    const schemaResult = await pool.query<{ id: number; user_id: number; name: string }>(
      'SELECT id, user_id, name FROM Schemas WHERE id = $1',
      [schemaId]
    );

    if (!schemaResult.rows.length) {
      return res.status(404).json({ message: 'Schema not found.' });
    }

    if (schemaResult.rows[0].user_id !== userId) {
      return res.status(403).json({ message: 'You can only view versions of your own diagrams.' });
    }

    const versionResult = await pool.query<SchemaVersion>(
      `SELECT id, schema_id, version_number, schema_json, notes, created_at, created_by_user_id
       FROM SchemaVersions
       WHERE id = $1 AND schema_id = $2`,
      [versionId, schemaId]
    );

    if (!versionResult.rows.length) {
      return res.status(404).json({ message: 'Version not found.' });
    }

    return res.status(200).json({
      schema: schemaResult.rows[0],
      version: versionResult.rows[0],
    });
  } catch (error: any) {
    console.error('Error fetching schema version detail:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

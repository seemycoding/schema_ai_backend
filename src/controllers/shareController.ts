import { Request, Response } from 'express';
import { getPlanFeaturesForUser } from '../utils/planFeatures';
import { pool } from '../config/db';

type InviteBody = {
  emails?: string[];
  permission?: 'view' | 'edit';
  invite_link?: string;
  diagram_type?: 'er' | 'system';
};

type RegisterLinkBody = {
  schema_id?: number;
  room_id?: string;
  permission?: 'view' | 'edit';
};

interface SharedSchemaRow {
  id: number;
  user_id: number;
  team_id: number | null;
  name: string;
  description: string | null;
  prompt_text: string;
  created_at: string;
  updated_at: string | null;
  current_version_id: number | null;
  current_schema_json: string | null;
  share_permission: 'view' | 'edit';
  room_id: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getMailTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials are not configured.');
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
};

const getInviteTemplate = ({
  ownerName,
  inviteLink,
  permission,
  diagramType,
}: {
  ownerName: string;
  inviteLink: string;
  permission: 'view' | 'edit';
  diagramType: 'er' | 'system';
}) => {
  const schemaTypeText = diagramType === 'system' ? 'System Design' : 'ERP/ER';
  const permissionText = permission === 'edit' ? 'edit' : 'view';

  return `
  <div style="font-family: Arial, sans-serif; background:#f4f6f8; padding:24px;">
    <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
      <div style="background:#0f172a; color:#ffffff; padding:16px 20px; display:flex; align-items:center; gap:12px;">
        <div style="width:36px; height:36px; border-radius:8px; background:#1d4ed8; display:flex; align-items:center; justify-content:center; font-weight:700;">SA</div>
        <div style="font-size:20px; font-weight:700;">Schema.AI</div>
      </div>
      <div style="padding:24px 20px; color:#111827; line-height:1.6;">
        <p style="margin:0 0 12px 0;">Hi,</p>
        <p style="margin:0 0 12px 0;">
          <strong>${ownerName}</strong> has invited you to collaborate on a
          <strong>${schemaTypeText}</strong> schema in Schema.AI.
        </p>
        <p style="margin:0 0 16px 0;">You have <strong>${permissionText}</strong> access. Please join using the following link:</p>
        <p style="margin:0 0 20px 0;">
          <a href="${inviteLink}" style="background:#1d4ed8; color:#ffffff; padding:10px 14px; border-radius:8px; text-decoration:none; display:inline-block;">Join Collaboration</a>
        </p>
        <p style="font-size:13px; color:#4b5563; margin:0;">
          If the button does not work, copy and paste this URL in your browser:<br/>
          <a href="${inviteLink}">${inviteLink}</a>
        </p>
      </div>
    </div>
  </div>`;
};

export const sendShareInvites = async (req: Request<{}, {}, InviteBody>, res: Response) => {
  const userId = req.user?.id;
  const ownerName = req.user?.username || 'Owner';

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const plan = await getPlanFeaturesForUser(userId, req.user?.plan_id);
  if (!plan.has_collaboration) {
    return res.status(403).json({ message: 'Invites are available on paid plans only.' });
  }

  const emails = (req.body.emails || []).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const permission = req.body.permission === 'edit' ? 'edit' : 'view';
  const inviteLink = (req.body.invite_link || '').trim();
  const diagramType = req.body.diagram_type === 'system' ? 'system' : 'er';
  let schemaId = 0;
  let roomId: string | null = null;

  if (!emails.length) {
    return res.status(400).json({ message: 'At least one email is required.' });
  }
  if (!inviteLink) {
    return res.status(400).json({ message: 'invite_link is required.' });
  }
  try {
    const inviteUrl = new URL(inviteLink);
    schemaId = Number(inviteUrl.searchParams.get('schemaId'));
    roomId = inviteUrl.searchParams.get('room') || null;
  } catch {
    return res.status(400).json({ message: 'invite_link is invalid.' });
  }
  if (!schemaId) {
    return res.status(400).json({ message: 'invite_link must contain schemaId.' });
  }

  const invalid = emails.filter((email) => !EMAIL_REGEX.test(email));
  if (invalid.length) {
    return res.status(400).json({ message: 'Some email addresses are invalid.', invalid_emails: invalid });
  }

  try {
    const schemaResult = await pool.query<{ user_id: number }>('SELECT user_id FROM Schemas WHERE id = $1', [schemaId]);
    if (!schemaResult.rows.length) {
      return res.status(404).json({ message: 'Schema not found.' });
    }
    if (schemaResult.rows[0].user_id !== userId) {
      return res.status(403).json({ message: 'You can only share your own schemas.' });
    }

    const transporter = getMailTransporter();
    const from = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'no-reply@schema.ai';
    const html = getInviteTemplate({ ownerName, inviteLink, permission, diagramType });
    const subject = `${ownerName} invited you to collaborate on Schema.AI`;

    // Persist share permissions so invitees can later access from "Shared with me".
    for (const email of emails) {
      const userResult = await pool.query<{ id: number }>('SELECT id FROM Users WHERE lower(email) = $1', [email]);
      const sharedWithUserId = userResult.rows[0]?.id || null;
      const updateByEmail = await pool.query(
        `UPDATE SchemaShares
         SET shared_by_user_id = $1,
             shared_with_user_id = $2,
             permission = $3,
             room_id = $4,
             updated_at = NOW()
         WHERE schema_id = $5
           AND lower(coalesce(shared_with_email, '')) = $6`,
        [userId, sharedWithUserId, permission, roomId, schemaId, email]
      );
      if (updateByEmail.rowCount === 0) {
        await pool.query(
          `INSERT INTO SchemaShares (schema_id, shared_by_user_id, shared_with_user_id, shared_with_email, permission, room_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [schemaId, userId, sharedWithUserId, email, permission, roomId]
        );
      }
      if (sharedWithUserId) {
        const updateByUser = await pool.query(
          `UPDATE SchemaShares
           SET shared_by_user_id = $1,
               permission = $2,
               room_id = $3,
               updated_at = NOW()
           WHERE schema_id = $4
             AND shared_with_user_id = $5`,
          [userId, permission, roomId, schemaId, sharedWithUserId]
        );
        if (updateByUser.rowCount === 0) {
          await pool.query(
            `INSERT INTO SchemaShares (schema_id, shared_by_user_id, shared_with_user_id, shared_with_email, permission, room_id, created_at, updated_at)
             VALUES ($1, $2, $3, NULL, $4, $5, NOW(), NOW())`,
            [schemaId, userId, sharedWithUserId, permission, roomId]
          );
        }
      }
    }

    const results = await Promise.allSettled(
      emails.map((email) =>
        transporter.sendMail({
          from,
          to: email,
          subject,
          html,
        })
      )
    );

    const sent: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];

    results.forEach((result, index) => {
      const email = emails[index];
      if (result.status === 'fulfilled') {
        sent.push(email);
      } else {
        failed.push({ email, error: result.reason?.message || 'Unknown error' });
      }
    });

    return res.status(200).json({
      message: 'Invite processing completed.',
      sent,
      failed,
    });
  } catch (error: any) {
    console.error('Error sending share invites:', error.message);
    return res.status(500).json({
      message: 'Unable to send invite emails.',
      details: error.message,
    });
  }
};

export const registerShareLinkAccess = async (req: Request<{}, {}, RegisterLinkBody>, res: Response) => {
  const userId = req.user?.id;
  const userEmail = req.user?.email?.toLowerCase();

  if (!userId || !userEmail) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const schemaId = Number(req.body.schema_id || 0);
  const roomId = req.body.room_id || null;
  const permission = req.body.permission === 'edit' ? 'edit' : 'view';

  if (!schemaId) {
    return res.status(400).json({ message: 'schema_id is required.' });
  }

  const schemaOwnerResult = await pool.query<{ user_id: number }>(
    'SELECT user_id FROM Schemas WHERE id = $1',
    [schemaId]
  );
  if (!schemaOwnerResult.rows.length) {
    return res.status(404).json({ message: 'Schema not found.' });
  }

  const ownerUserId = schemaOwnerResult.rows[0].user_id;
  if (ownerUserId === userId) {
    return res.status(200).json({ message: 'Owner access already granted.' });
  }

  const updated = await pool.query(
    `UPDATE SchemaShares
     SET permission = CASE WHEN $1 = 'edit' THEN 'edit' ELSE permission END,
         room_id = COALESCE($2, room_id),
         updated_at = NOW()
     WHERE schema_id = $3
       AND shared_with_user_id = $4`,
    [permission, roomId, schemaId, userId]
  );
  if (updated.rowCount === 0) {
    await pool.query(
      `INSERT INTO SchemaShares (schema_id, shared_by_user_id, shared_with_user_id, shared_with_email, permission, room_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [schemaId, ownerUserId, userId, userEmail, permission, roomId]
    );
  }

  return res.status(200).json({ message: 'Share link access registered.' });
};

export const getSharedWithMeSchemas = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const userEmail = req.user?.email?.toLowerCase();

  if (!userId || !userEmail) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const result = await pool.query<SharedSchemaRow>(
    `SELECT DISTINCT ON (s.id)
      s.id,
      s.user_id,
      s.team_id,
      s.name,
      s.description,
      s.prompt_text,
      s.created_at::text,
      s.updated_at::text,
      s.current_version_id,
      sv.schema_json AS current_schema_json,
      ss.permission AS share_permission,
      ss.room_id
    FROM SchemaShares ss
    INNER JOIN Schemas s ON s.id = ss.schema_id
    LEFT JOIN SchemaVersions sv ON s.current_version_id = sv.id
    WHERE ss.shared_with_user_id = $1
      OR lower(coalesce(ss.shared_with_email, '')) = $2
    ORDER BY s.id, ss.updated_at DESC`,
    [userId, userEmail]
  );

  return res.status(200).json({
    message: 'Shared schemas fetched successfully.',
    schemas: result.rows,
  });
};

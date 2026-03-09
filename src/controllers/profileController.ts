import { Request, Response } from 'express';
import { pool } from '../config/db';

export const getProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, email, plan_id, created_at, last_login_at
       FROM Users
       WHERE id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({ profile: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching profile:', error.message);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

export const deleteProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM SchemaVersions
       WHERE schema_id IN (SELECT id FROM Schemas WHERE user_id = $1)`,
      [userId]
    );

    await client.query('DELETE FROM Schemas WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM PromptHistory WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM SocialLogins WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM TeamMembers WHERE user_id = $1', [userId]);

    await client.query(
      `DELETE FROM TeamMembers
       WHERE team_id IN (SELECT id FROM Teams WHERE owner_user_id = $1)`,
      [userId]
    );
    await client.query('DELETE FROM Teams WHERE owner_user_id = $1', [userId]);

    await client.query('DELETE FROM Users WHERE id = $1', [userId]);

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Account deleted successfully.' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error deleting profile:', error.message);
    return res.status(500).json({ message: 'Unable to delete account.' });
  } finally {
    client.release();
  }
};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProfile = exports.getProfile = void 0;
const db_1 = require("../config/db");
const getProfile = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    try {
        const result = await db_1.pool.query(`SELECT id, username, email, plan_id, created_at, last_login_at
       FROM Users
       WHERE id = $1`, [userId]);
        if (!result.rows.length) {
            return res.status(404).json({ message: 'User not found.' });
        }
        return res.status(200).json({ profile: result.rows[0] });
    }
    catch (error) {
        console.error('Error fetching profile:', error.message);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
exports.getProfile = getProfile;
const deleteProfile = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM SchemaVersions
       WHERE schema_id IN (SELECT id FROM Schemas WHERE user_id = $1)`, [userId]);
        await client.query('DELETE FROM Schemas WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM PromptHistory WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM SocialLogins WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM TeamMembers WHERE user_id = $1', [userId]);
        await client.query(`DELETE FROM TeamMembers
       WHERE team_id IN (SELECT id FROM Teams WHERE owner_user_id = $1)`, [userId]);
        await client.query('DELETE FROM Teams WHERE owner_user_id = $1', [userId]);
        await client.query('DELETE FROM Users WHERE id = $1', [userId]);
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Account deleted successfully.' });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting profile:', error.message);
        return res.status(500).json({ message: 'Unable to delete account.' });
    }
    finally {
        client.release();
    }
};
exports.deleteProfile = deleteProfile;

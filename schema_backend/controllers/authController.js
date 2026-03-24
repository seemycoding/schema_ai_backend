"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleCallback = exports.googleInitiate = exports.githubCallback = exports.githubInitiate = exports.resetPassword = exports.forgotPassword = exports.loginUser = exports.registerUser = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const axios_1 = __importDefault(require("axios")); // Import axios
// Get the raw secret from environment variables
const JWT_SECRET_RAW = process.env.JWT_SECRET;
// --- CRITICAL: Ensure JWT_SECRET is a non-empty string ---
if (typeof JWT_SECRET_RAW !== 'string' || JWT_SECRET_RAW.length === 0) {
    console.error('ERROR: JWT_SECRET is not defined or is empty in environment variables. Please set it in your .env file.');
    process.exit(1);
}
const JWT_SECRET = JWT_SECRET_RAW;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
// Frontend URL for redirect after social login (e.g., where your React app handles the token)
const frontendBaseUrl = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.replace(/\/$/, '')
    : '';
const FRONTEND_AUTH_CALLBACK_URL = process.env.FRONTEND_AUTH_CALLBACK_URL ||
    (frontendBaseUrl ? `${frontendBaseUrl}/auth/callback` : '') ||
    'http://localhost:5173/auth/callback';
const FRONTEND_RESET_PASSWORD_URL = process.env.FRONTEND_RESET_PASSWORD_URL ||
    (frontendBaseUrl ? `${frontendBaseUrl}/reset-password` : '') ||
    'http://localhost:5173/reset-password';
const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || '30');
const resolveJwtExpiry = (raw) => {
    // If raw is all digits, treat it as seconds to avoid ms-parsing pitfalls (e.g. "1" => 1ms).
    if (/^\d+$/.test(raw)) {
        return Number(raw);
    }
    return raw;
};
// --- Helper function to generate JWT ---
const generateJwtToken = (user) => {
    return jsonwebtoken_1.default.sign({ id: user.id, username: user.username, email: user.email, plan_id: user.plan_id }, JWT_SECRET, { expiresIn: resolveJwtExpiry(JWT_EXPIRES_IN) });
};
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
        auth: { user, pass },
    });
};
const hashResetToken = (token) => crypto_1.default.createHash('sha256').update(token).digest('hex');
const buildResetPasswordTemplate = (resetLink) => `
  <div style="font-family: Arial, sans-serif; background:#f4f6f8; padding:24px;">
    <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
      <div style="background:#0f172a; color:#ffffff; padding:16px 20px; display:flex; align-items:center; gap:12px;">
        <div style="width:36px; height:36px; border-radius:8px; background:#1d4ed8; display:flex; align-items:center; justify-content:center; font-weight:700;">SA</div>
        <div style="font-size:20px; font-weight:700;">Schema.AI</div>
      </div>
      <div style="padding:24px 20px; color:#111827; line-height:1.6;">
        <p style="margin:0 0 12px 0;">A password reset was requested for your account.</p>
        <p style="margin:0 0 16px 0;">Use the link below to set a new password. This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.</p>
        <p style="margin:0 0 20px 0;">
          <a href="${resetLink}" style="background:#1d4ed8; color:#ffffff; padding:10px 14px; border-radius:8px; text-decoration:none; display:inline-block;">Reset Password</a>
        </p>
        <p style="font-size:13px; color:#4b5563; margin:0;">
          If the button does not work, copy and paste this URL in your browser:<br/>
          <a href="${resetLink}">${resetLink}</a>
        </p>
      </div>
    </div>
  </div>`;
const findOrCreateSocialUser = async (socialUser) => {
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction
        // 1. Check if social login already exists
        const socialLoginResult = await client.query('SELECT user_id FROM SocialLogins WHERE provider = $1 AND provider_id = $2', [socialUser.provider, socialUser.providerId]);
        let user = null;
        if (socialLoginResult.rows.length > 0) {
            // Social login exists, retrieve the user
            const userId = socialLoginResult.rows[0].user_id;
            const userResult = await client.query('SELECT * FROM Users WHERE id = $1', [userId]);
            user = userResult.rows[0];
            if (user) {
                // Update last_login_at
                await client.query('UPDATE Users SET last_login_at = NOW() WHERE id = $1', [user.id]);
            }
        }
        else {
            // Social login does NOT exist, check for existing user by email
            const existingUserResult = await client.query('SELECT * FROM Users WHERE email = $1', [socialUser.email]);
            if (existingUserResult.rows.length > 0) {
                // User with this email exists, link social login to existing user
                user = existingUserResult.rows[0];
                await client.query('INSERT INTO SocialLogins (user_id, provider, provider_id, created_at) VALUES ($1, $2, $3, NOW())', [user.id, socialUser.provider, socialUser.providerId]);
                // Update last_login_at
                await client.query('UPDATE Users SET last_login_at = NOW() WHERE id = $1', [user.id]);
            }
            else {
                // Completely new user and social login
                // Generate a random password hash for social login users (they won't use it directly)
                const tempPasswordHash = await bcrypt_1.default.hash(Math.random().toString(36).substring(2, 15), 10);
                const newUserResult = await client.query(`INSERT INTO Users (email, password_hash, username, plan_id, created_at, last_login_at)
                     VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, username, email, plan_id`, [socialUser.email, tempPasswordHash, socialUser.username || socialUser.email.split('@')[0], 1] // Default plan_id=1, derive username if not provided
                );
                user = newUserResult.rows[0];
                await client.query('INSERT INTO SocialLogins (user_id, provider, provider_id, created_at) VALUES ($1, $2, $3, NOW())', [user.id, socialUser.provider, socialUser.providerId]);
            }
        }
        if (!user) {
            throw new Error('Failed to find or create user for social login.');
        }
        await client.query('COMMIT'); // Commit transaction
        const token = generateJwtToken(user);
        return { user, token };
    }
    catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        throw error;
    }
    finally {
        client.release();
    }
};
// --- User Registration (existing from previous example) ---
const registerUser = async (req, res) => {
    const email = req.body.email?.trim().toLowerCase();
    const { password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'All fields (username, email, password) are required.' });
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ message: 'Invalid email format.' });
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()]/.test(password)) {
        return res.status(400).json({
            message: 'Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.'
        });
    }
    try {
        const existingUser = await db_1.pool.query('SELECT id, email FROM Users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ message: 'Email already registered.' });
        }
        const saltRounds = 10;
        const passwordHash = await bcrypt_1.default.hash(password, saltRounds);
        const newUserResult = await db_1.pool.query(`INSERT INTO Users (email, password_hash, username, plan_id, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, username, email, plan_id, created_at`, [email, passwordHash, email.split("@")[0], 4]);
        const newUser = newUserResult.rows[0];
        const token = generateJwtToken(newUser);
        res.status(201).json({
            message: 'User registered successfully!',
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
                plan_id: newUser.plan_id,
                created_at: newUser.created_at
            },
            token
        });
    }
    catch (error) {
        console.error('Error during user registration:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
exports.registerUser = registerUser;
// --- User Login (existing from previous example) ---
const loginUser = async (req, res) => {
    const email = req.body.email?.trim().toLowerCase();
    const { password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }
    try {
        const userResult = await db_1.pool.query('SELECT id, username, email, password_hash, plan_id FROM Users WHERE email = $1', [email]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const isMatch = await bcrypt_1.default.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const token = generateJwtToken(user);
        await db_1.pool.query('UPDATE Users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        res.status(200).json({
            message: 'Login successful!',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                plan_id: user.plan_id
            }
        });
    }
    catch (error) {
        console.error('Error during user login:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
exports.loginUser = loginUser;
const forgotPassword = async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
        return res.status(400).json({ message: 'Email is required.' });
    }
    try {
        const userResult = await db_1.pool.query('SELECT id, email, username, plan_id, password_hash FROM Users WHERE lower(email) = $1', [email]);
        if (!userResult.rows.length) {
            return res.status(200).json({
                message: 'If an account with that email exists, a reset link has been sent.',
            });
        }
        const user = userResult.rows[0];
        const rawToken = crypto_1.default.randomBytes(32).toString('hex');
        const tokenHash = hashResetToken(rawToken);
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
        await db_1.pool.query('UPDATE PasswordResetTokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
        await db_1.pool.query(`INSERT INTO PasswordResetTokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, NOW())`, [user.id, tokenHash, expiresAt]);
        const resetLink = `${FRONTEND_RESET_PASSWORD_URL}?token=${rawToken}`;
        const transporter = getMailTransporter();
        const from = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'no-reply@schema.ai';
        await transporter.sendMail({
            from,
            to: user.email,
            subject: 'Reset your Schema.AI password',
            html: buildResetPasswordTemplate(resetLink),
        });
        return res.status(200).json({
            message: 'If an account with that email exists, a reset link has been sent.',
        });
    }
    catch (error) {
        console.error('Error sending password reset email:', error.message);
        return res.status(500).json({ message: 'Unable to process password reset request.' });
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res) => {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token || !password) {
        return res.status(400).json({ message: 'Token and password are required.' });
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()]/.test(password)) {
        return res.status(400).json({
            message: 'Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.'
        });
    }
    const tokenHash = hashResetToken(token);
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        const tokenResult = await client.query(`SELECT id, user_id, expires_at, used_at
       FROM PasswordResetTokens
       WHERE token_hash = $1
       ORDER BY created_at DESC
       LIMIT 1`, [tokenHash]);
        if (!tokenResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid or expired reset token.' });
        }
        const resetRow = tokenResult.rows[0];
        if (resetRow.used_at || new Date(resetRow.expires_at).getTime() < Date.now()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid or expired reset token.' });
        }
        const passwordHash = await bcrypt_1.default.hash(password, 10);
        await client.query('UPDATE Users SET password_hash = $1 WHERE id = $2', [passwordHash, resetRow.user_id]);
        await client.query('UPDATE PasswordResetTokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [resetRow.user_id]);
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Password reset successful.' });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Error resetting password:', error.message);
        return res.status(500).json({ message: 'Unable to reset password.' });
    }
    finally {
        client.release();
    }
};
exports.resetPassword = resetPassword;
// --- GitHub Social Login ---
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;
if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_REDIRECT_URI) {
    console.warn('WARNING: GitHub OAuth credentials are not fully configured in .env');
}
const githubInitiate = (req, res) => {
    if (!GITHUB_CLIENT_ID || !GITHUB_REDIRECT_URI) {
        return res.status(500).json({ message: 'GitHub OAuth not configured.' });
    }
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=user:email`;
    res.redirect(githubAuthUrl);
};
exports.githubInitiate = githubInitiate;
const githubCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_no_code`);
    }
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_REDIRECT_URI) {
        return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_config_missing`);
    }
    try {
        // 1. Exchange code for access token
        const tokenResponse = await axios_1.default.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: GITHUB_REDIRECT_URI,
        }, {
            headers: { Accept: 'application/json' },
        });
        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            throw new Error('No access token from GitHub');
        }
        // 2. Fetch user data from GitHub API
        const userResponse = await axios_1.default.get('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const emailResponse = await axios_1.default.get('https://api.github.com/user/emails', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const githubUser = userResponse.data;
        const primaryEmail = emailResponse.data.find((e) => e.primary && e.verified);
        if (!primaryEmail) {
            return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_no_verified_email`);
        }
        const socialUser = {
            provider: 'github',
            providerId: githubUser.id.toString(), // GitHub ID is a number, store as string
            email: primaryEmail.email,
            username: githubUser.login, // GitHub username
        };
        const { token } = await findOrCreateSocialUser(socialUser);
        // Redirect to frontend with JWT
        res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?token=${token}`);
    }
    catch (error) {
        console.error('GitHub OAuth Error:', error.message);
        res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_login_failed`);
    }
};
exports.githubCallback = githubCallback;
// --- Google Social Login ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    console.warn('WARNING: Google OAuth credentials are not fully configured in .env');
}
const googleInitiate = (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
        return res.status(500).json({ message: 'Google OAuth not configured.' });
    }
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${GOOGLE_REDIRECT_URI}&response_type=code&scope=profile email`;
    res.redirect(googleAuthUrl);
};
exports.googleInitiate = googleInitiate;
const googleCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_no_code`);
    }
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
        return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_config_missing`);
    }
    try {
        // 1. Exchange code for tokens (access_token and id_token)
        const tokenResponse = await axios_1.default.post('https://oauth2.googleapis.com/token', {
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code',
        });
        const { id_token } = tokenResponse.data;
        if (!id_token) {
            throw new Error('No ID token from Google');
        }
        // 2. Verify token with Google's tokeninfo endpoint
        const tokenInfoResponse = await axios_1.default.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`);
        const googlePayload = tokenInfoResponse.data;
        if (!googlePayload ||
            !googlePayload.sub ||
            !googlePayload.email ||
            (googlePayload.email_verified !== true && googlePayload.email_verified !== 'true')) {
            return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_email_not_verified`);
        }
        if (googlePayload.aud !== GOOGLE_CLIENT_ID) {
            return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_invalid_audience`);
        }
        const socialUser = {
            provider: 'google',
            providerId: googlePayload.sub, // Google user ID
            email: googlePayload.email,
            username: googlePayload.name || googlePayload.email.split('@')[0], // Google username/name
        };
        const { token } = await findOrCreateSocialUser(socialUser);
        // Redirect to frontend with JWT
        res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?token=${token}`);
    }
    catch (error) {
        console.error('Google OAuth Error:', error.message);
        res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_login_failed`);
    }
};
exports.googleCallback = googleCallback;

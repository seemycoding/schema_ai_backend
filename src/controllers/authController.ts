// src/controllers/authController.ts
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { NewUserRegistration,User,SocialUser } from '../interface/UserInterface';
import axios from 'axios'; // Import axios

// Get the raw secret from environment variables
const JWT_SECRET_RAW = process.env.JWT_SECRET;

// --- CRITICAL: Ensure JWT_SECRET is a non-empty string ---
if (typeof JWT_SECRET_RAW !== 'string' || JWT_SECRET_RAW.length === 0) {
    console.error('ERROR: JWT_SECRET is not defined or is empty in environment variables. Please set it in your .env file.');
    process.exit(1);
}
const JWT_SECRET: string = JWT_SECRET_RAW;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// Frontend URL for redirect after social login (e.g., where your React app handles the token)
const frontendBaseUrl = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.replace(/\/$/, '')
  : '';
const FRONTEND_AUTH_CALLBACK_URL =
  process.env.FRONTEND_AUTH_CALLBACK_URL ||
  (frontendBaseUrl ? `${frontendBaseUrl}/auth/callback` : '') ||
  'http://localhost:5173/auth/callback';

const resolveJwtExpiry = (raw: string): string | number => {
  // If raw is all digits, treat it as seconds to avoid ms-parsing pitfalls (e.g. "1" => 1ms).
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  return raw;
};

// --- Helper function to generate JWT ---
const generateJwtToken = (user: { id: number; username: string; email: string; plan_id: number; }) => {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, plan_id: user.plan_id },
    JWT_SECRET,
    { expiresIn: resolveJwtExpiry(JWT_EXPIRES_IN) as any }
  );
};



const findOrCreateSocialUser = async (socialUser: SocialUser): Promise<{ user: User, token: string }> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction

        // 1. Check if social login already exists
        const socialLoginResult = await client.query<{ user_id: number }>(
            'SELECT user_id FROM SocialLogins WHERE provider = $1 AND provider_id = $2',
            [socialUser.provider, socialUser.providerId]
        );

        let user: User | null = null;
        if (socialLoginResult.rows.length > 0) {
            // Social login exists, retrieve the user
            const userId = socialLoginResult.rows[0].user_id;
            const userResult = await client.query<User>('SELECT * FROM Users WHERE id = $1', [userId]);
            user = userResult.rows[0];
            if (user) {
                // Update last_login_at
                await client.query('UPDATE Users SET last_login_at = NOW() WHERE id = $1', [user.id]);
            }
        } else {
            // Social login does NOT exist, check for existing user by email
            const existingUserResult = await client.query<User>('SELECT * FROM Users WHERE email = $1', [socialUser.email]);
            if (existingUserResult.rows.length > 0) {
                // User with this email exists, link social login to existing user
                user = existingUserResult.rows[0];
                await client.query(
                    'INSERT INTO SocialLogins (user_id, provider, provider_id, created_at) VALUES ($1, $2, $3, NOW())',
                    [user.id, socialUser.provider, socialUser.providerId]
                );
                // Update last_login_at
                await client.query('UPDATE Users SET last_login_at = NOW() WHERE id = $1', [user.id]);
            } else {
                // Completely new user and social login
                // Generate a random password hash for social login users (they won't use it directly)
                const tempPasswordHash = await bcrypt.hash(Math.random().toString(36).substring(2, 15), 10);
                const newUserResult = await client.query<User>(
                    `INSERT INTO Users (email, password_hash, username, plan_id, created_at, last_login_at)
                     VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, username, email, plan_id`,
                    [socialUser.email, tempPasswordHash, socialUser.username || socialUser.email.split('@')[0], 1] // Default plan_id=1, derive username if not provided
                );
                user = newUserResult.rows[0];

                await client.query(
                    'INSERT INTO SocialLogins (user_id, provider, provider_id, created_at) VALUES ($1, $2, $3, NOW())',
                    [user.id, socialUser.provider, socialUser.providerId]
                );
            }
        }

        if (!user) {
            throw new Error('Failed to find or create user for social login.');
        }

        await client.query('COMMIT'); // Commit transaction
        const token = generateJwtToken(user);
        return { user, token };

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        throw error;
    } finally {
        client.release();
    }
};

// --- User Registration (existing from previous example) ---
export const registerUser = async (req: Request<{}, {}, NewUserRegistration>, res: Response) => {
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
    const existingUser = await pool.query<User>(
      'SELECT id, email FROM Users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const newUserResult = await pool.query<User>(
      `INSERT INTO Users (email, password_hash, username, plan_id, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, username, email, plan_id, created_at`,
      [email, passwordHash, email.split("@")[0], 4]
    );

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

  } catch (error: any) {
    console.error('Error during user registration:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// --- User Login (existing from previous example) ---
export const loginUser = async (req: Request<{}, {}, Pick<NewUserRegistration, 'email' | 'password'>>, res: Response) => {
  const email = req.body.email?.trim().toLowerCase();
  const { password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const userResult = await pool.query<User>(
      'SELECT id, username, email, password_hash, plan_id FROM Users WHERE email = $1',
      [email]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = generateJwtToken(user);

    await pool.query('UPDATE Users SET last_login_at = NOW() WHERE id = $1', [user.id]);

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

  } catch (error: any) {
    console.error('Error during user login:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// --- GitHub Social Login ---
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_REDIRECT_URI) {
  console.warn('WARNING: GitHub OAuth credentials are not fully configured in .env');
}

export const githubInitiate = (req: Request, res: Response) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_REDIRECT_URI) {
    return res.status(500).json({ message: 'GitHub OAuth not configured.' });
  }
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${GITHUB_REDIRECT_URI}&scope=user:email`;
  res.redirect(githubAuthUrl);
};

export const githubCallback = async (req: Request, res: Response) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_no_code`);
  }
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_REDIRECT_URI) {
    return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_config_missing`);
  }

  try {
    // 1. Exchange code for access token
    const tokenResponse:any = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      },
      {
        headers: { Accept: 'application/json' },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
        throw new Error('No access token from GitHub');
    }

    // 2. Fetch user data from GitHub API
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const emailResponse:any = await axios.get('https://api.github.com/user/emails', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const githubUser:any = userResponse.data;
    const primaryEmail = emailResponse.data.find((e: any) => e.primary && e.verified);

    if (!primaryEmail) {
        return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_no_verified_email`);
    }

    const socialUser: SocialUser = {
        provider: 'github',
        providerId: githubUser.id.toString(), // GitHub ID is a number, store as string
        email: primaryEmail.email,
        username: githubUser.login, // GitHub username
    };

    const { token } = await findOrCreateSocialUser(socialUser);

    // Redirect to frontend with JWT
    res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?token=${token}`);

  } catch (error: any) {
    console.error('GitHub OAuth Error:', error.message);
    res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=github_login_failed`);
  }
};

// --- Google Social Login ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    console.warn('WARNING: Google OAuth credentials are not fully configured in .env');
}

export const googleInitiate = (req: Request, res: Response) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
        return res.status(500).json({ message: 'Google OAuth not configured.' });
    }
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${GOOGLE_REDIRECT_URI}&response_type=code&scope=profile email`;
    res.redirect(googleAuthUrl);
};

export const googleCallback = async (req: Request, res: Response) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_no_code`);
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_config_missing`);
  }

  try {
    // 1. Exchange code for tokens (access_token and id_token)
    const tokenResponse:any = await axios.post('https://oauth2.googleapis.com/token', {
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
    const tokenInfoResponse: any = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`
    );
    const googlePayload: any = tokenInfoResponse.data;

    if (
      !googlePayload ||
      !googlePayload.sub ||
      !googlePayload.email ||
      (googlePayload.email_verified !== true && googlePayload.email_verified !== 'true')
    ) {
        return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_email_not_verified`);
    }

    if (googlePayload.aud !== GOOGLE_CLIENT_ID) {
      return res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_invalid_audience`);
    }

    const socialUser: SocialUser = {
        provider: 'google',
        providerId: googlePayload.sub, // Google user ID
        email: googlePayload.email,
        username: googlePayload.name || googlePayload.email.split('@')[0], // Google username/name
    };

    const { token } = await findOrCreateSocialUser(socialUser);

    // Redirect to frontend with JWT
    res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?token=${token}`);

  } catch (error: any) {
    console.error('Google OAuth Error:', error.message);
    res.redirect(`${FRONTEND_AUTH_CALLBACK_URL}?error=google_login_failed`);
  }
};

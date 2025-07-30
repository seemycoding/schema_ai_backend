// src/controllers/authController.ts
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { NewUserRegistration, User } from '../interface/UserInterface';

// JWT Secret from environment variables
const JWT_SECRET:string = process.env.JWT_SECRET || 'supersecretdefaultkey'; // Fallback for dev, but set in .env!
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || 1;

// --- User Registration ---
export const registerUser = async (req: Request<{}, {}, NewUserRegistration>, res: Response) => {
  const {  email, password } = req.body;

  // 1. Basic Validation
  if (!email || !password) {
    return res.status(400).json({ message: 'All fields (username, email, password) are required.' });
  }

  // Basic email format check (more robust validation can be done with libraries like 'validator')
  if (!/\S+@\S+\.\S+/.test(email)) {
    return res.status(400).json({ message: 'Invalid email format.' });
  }

  // Basic password strength check (enhance as needed)
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()]/.test(password)) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character.'
    });
  }

  try {
    // 2. Check for existing user (email or username)
    const existingUser = await pool.query<User>(
      'SELECT id FROM Users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      const conflict = existingUser.rows[0];
      if (conflict.email === email) {
        return res.status(409).json({ message: 'Email already registered.' });
      } else {
        return res.status(409).json({ message: 'Username already taken.' });
      }
    }

    // 3. Hash the password
    const saltRounds = 10; // Standard number of salt rounds
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 4. Create new user in the database
    // Note: Assuming a default plan_id=1 for new registrations (e.g., Free Plan)
    const newUserResult = await pool.query<User>(
      `INSERT INTO Users (email, password_hash,username,plan_id, created_at, last_login_at)
       VALUES ($1, $2, $3,$4, NOW(), NOW()) RETURNING id, email, plan_id, created_at`,
      [email, passwordHash,email.split("@")[0],2] // Assigning default plan_id 2
    );

    const newUser = newUserResult.rows[0];

    // 5. Generate JWT for immediate login
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, email: newUser.email, plan_id: newUser.plan_id },
      JWT_SECRET,
    );

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

// --- User Login ---
export const loginUser = async (req: Request<{}, {}, Pick<NewUserRegistration, 'email' | 'password'>>, res: Response) => {
  const { email, password } = req.body;

  // 1. Basic Validation
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    // 2. Find user by email
    const userResult = await pool.query<User>(
      'SELECT id, username, email, password_hash, plan_id FROM Users WHERE email = $1',
      [email]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' }); // Generic message for security
    }

    // 3. Compare passwords
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' }); // Generic message
    }

    // 4. Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, plan_id: user.plan_id },
      JWT_SECRET,
    );

    // 5. Update last_login_at timestamp
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
// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend the Request type to include a user property
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; username: string; email: string; plan_id: number };
    }
  }
}

const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (typeof JWT_SECRET_RAW !== 'string' || JWT_SECRET_RAW.length === 0) {
    console.error('ERROR: JWT_SECRET is not defined or is empty. Cannot start without JWT_SECRET.');
    process.exit(1);
}
const JWT_SECRET: string = JWT_SECRET_RAW;

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 1. Get token from header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  const token = authHeader.split(' ')[1]; // Extract the token after 'Bearer '

  // 2. Verify token
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: number;
      username: string;
      email: string;
      plan_id: number;
      iat: number;
      exp: number;
    };

    // Attach user information to the request object
    // This makes user.id available in your controllers
    req.user = {
      id: decoded.id,
      username: decoded.username,
      email: decoded.email,
      plan_id: decoded.plan_id,
    };

    next(); // Proceed to the next middleware/route handler
  } catch (error: any) {
    console.error('Token verification error:', error.message);
    res.status(401).json({ message: 'Token is not valid' });
  }
};
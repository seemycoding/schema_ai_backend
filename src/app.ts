// src/app.ts
import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import appRoutes from './routes/appRoutes';
import billingRoutes from './routes/billingRoutes';
import './config/db'; // Import to ensure DB connection is established
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8000);

const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Middleware to parse JSON bodies
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/app/v1', appRoutes);
app.use('/api/billing/v1', billingRoutes);

// Simple root route
app.get('/', (_req, res) => {
  res.send('Welcome to the AI Database Builder API!');
});

console.log(`Access register API: /api/auth/register on port ${PORT}`);
console.log(`Access login API: /api/auth/login on port ${PORT}`);

export default app;

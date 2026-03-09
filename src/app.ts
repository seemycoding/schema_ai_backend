// src/app.ts
import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import appRoutes from './routes/appRoutes';
import billingRoutes from './routes/billingRoutes';
import './config/db'; // Import to ensure DB connection is established
import cors from "cors"

dotenv.config();

const app = express();
const PORT = process.env.PORT;

// Middleware to parse JSON bodies
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(cors())
// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/app/v1',appRoutes)
app.use('/api/billing/v1', billingRoutes);

// Simple root route
app.get('/', (req, res) => {
  res.send('Welcome to the AI Database Builder API!');
});


  console.log(`Access register API: http://localhost:${PORT}/api/auth/register`);
  console.log(`Access login API: http://localhost:${PORT}/api/auth/login`);

export default app

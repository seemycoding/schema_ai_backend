// src/app.ts
import express from 'express';
import dotenv from 'dotenv';
import authRoutes from './routes/routes';
import './config/db'; // Import to ensure DB connection is established

dotenv.config();

const app = express();
const PORT = process.env.PORT;

// Middleware to parse JSON bodies
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);

// Simple root route
app.get('/', (req, res) => {
  res.send('Welcome to the AI Database Builder API!');
});


  console.log(`Access register API: http://localhost:${PORT}/api/auth/register`);
  console.log(`Access login API: http://localhost:${PORT}/api/auth/login`);

export default app
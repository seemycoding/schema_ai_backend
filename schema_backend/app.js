"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const appRoutes_1 = __importDefault(require("./routes/appRoutes"));
const billingRoutes_1 = __importDefault(require("./routes/billingRoutes"));
require("./config/db"); // Import to ensure DB connection is established
const cors_1 = __importDefault(require("cors"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT || 8000);
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
// Middleware to parse JSON bodies
app.use(express_1.default.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf.toString();
    },
}));
app.use((0, cors_1.default)({
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
}));
// API Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/app/v1', appRoutes_1.default);
app.use('/api/billing/v1', billingRoutes_1.default);
// Simple root route
app.get('/', (_req, res) => {
    res.send('Welcome to the AI Database Builder API!');
});
console.log(`Access register API: /api/auth/register on port ${PORT}`);
console.log(`Access login API: /api/auth/login on port ${PORT}`);
exports.default = app;

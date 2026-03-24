"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (typeof JWT_SECRET_RAW !== 'string' || JWT_SECRET_RAW.length === 0) {
    console.error('ERROR: JWT_SECRET is not defined or is empty. Cannot start without JWT_SECRET.');
    process.exit(1);
}
const JWT_SECRET = JWT_SECRET_RAW;
const authMiddleware = (req, res, next) => {
    // 1. Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }
    const token = authHeader.split(' ')[1]; // Extract the token after 'Bearer '
    // 2. Verify token
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // Attach user information to the request object
        // This makes user.id available in your controllers
        req.user = {
            id: decoded.id,
            username: decoded.username,
            email: decoded.email,
            plan_id: decoded.plan_id,
        };
        next(); // Proceed to the next middleware/route handler
    }
    catch (error) {
        console.error('Token verification error:', error.message);
        res.status(401).json({ message: 'Token is not valid' });
    }
};
exports.authMiddleware = authMiddleware;

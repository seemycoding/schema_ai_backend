import express from 'express';
import { getHome } from '../controllers/controller';
import { forgotPassword, githubCallback, githubInitiate, googleCallback, googleInitiate, loginUser, registerUser, resetPassword } from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';
import { saveSchema,getSchemas } from '../controllers/schemaController';
const router = express.Router();

router.get('/', getHome);

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// GitHub Social Auth
router.get('/github/initiate', githubInitiate);
router.get('/github/callback', githubCallback);

// Google Social Auth
router.get('/google/initiate', googleInitiate);
router.get('/google/callback', googleCallback);

export default router;

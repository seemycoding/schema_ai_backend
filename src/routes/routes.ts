import express from 'express';
import { getHome } from '../controllers/controller';
import { loginUser, registerUser } from '../controllers/authController';

const router = express.Router();

router.get('/', getHome);
router.post('/register', registerUser);
router.post('/login', loginUser);

export default router;
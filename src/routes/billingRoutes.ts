import express from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  createPaymentLink,
  getBillingPlans,
  getPaymentStatus,
  razorpayWebhook,
} from '../controllers/billingController';

const router = express.Router();

router.get('/plans', authMiddleware, getBillingPlans);
router.post('/create-payment-link', authMiddleware, createPaymentLink);
router.get('/payment-status', authMiddleware, getPaymentStatus);
router.post('/webhook', razorpayWebhook);

export default router;

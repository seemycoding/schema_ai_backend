"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const billingController_1 = require("../controllers/billingController");
const router = express_1.default.Router();
router.get('/plans', billingController_1.getBillingPlans);
router.post('/create-payment-link', auth_1.authMiddleware, billingController_1.createPaymentLink);
router.get('/payment-status', auth_1.authMiddleware, billingController_1.getPaymentStatus);
router.post('/webhook', billingController_1.razorpayWebhook);
exports.default = router;

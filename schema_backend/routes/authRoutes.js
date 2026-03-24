"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const controller_1 = require("../controllers/controller");
const authController_1 = require("../controllers/authController");
const router = express_1.default.Router();
router.get('/', controller_1.getHome);
router.post('/register', authController_1.registerUser);
router.post('/login', authController_1.loginUser);
router.post('/forgot-password', authController_1.forgotPassword);
router.post('/reset-password', authController_1.resetPassword);
// GitHub Social Auth
router.get('/github/initiate', authController_1.githubInitiate);
router.get('/github/callback', authController_1.githubCallback);
// Google Social Auth
router.get('/google/initiate', authController_1.googleInitiate);
router.get('/google/callback', authController_1.googleCallback);
exports.default = router;

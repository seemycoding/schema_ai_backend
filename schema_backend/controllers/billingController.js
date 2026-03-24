"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayWebhook = exports.getPaymentStatus = exports.createPaymentLink = exports.getBillingPlans = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
const getRazorpayCreds = () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw new Error('Razorpay credentials not configured');
    }
    return { keyId, keySecret };
};
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const resolveJwtExpiry = (raw) => {
    if (/^\d+$/.test(raw)) {
        return Number(raw);
    }
    return raw;
};
const generateBillingJwtToken = (user) => {
    if (!JWT_SECRET) {
        throw new Error('JWT secret is not configured.');
    }
    return jsonwebtoken_1.default.sign({ id: user.id, username: user.username, email: user.email, plan_id: user.plan_id }, JWT_SECRET, { expiresIn: resolveJwtExpiry(JWT_EXPIRES_IN) });
};
const getFrontendBaseUrl = () => {
    return process.env.FRONTEND_URL || 'http://localhost:5173';
};
const getMethodConfig = (preferredMethod) => {
    return {
        card: preferredMethod === 'card',
        netbanking: preferredMethod === 'netbanking',
        upi: preferredMethod === 'upi',
        wallet: true,
        emi: false,
        paylater: false,
    };
};
const toNumber = (value) => {
    if (typeof value === 'number') {
        return value;
    }
    return Number(value);
};
const toPlanKey = (name) => {
    const key = name.trim().toLowerCase();
    if (!key) {
        return 'custom';
    }
    return key.replace(/\s+/g, '-');
};
const mapPlanRow = (row) => {
    const maxDiagrams = row.max_diagrams >= 0 ? row.max_diagrams : null;
    const isPaid = toNumber(row.price) > 0 || Boolean(row.has_collaboration) || Boolean(row.has_version_history);
    const features = [];
    if (maxDiagrams !== null) {
        features.push(`Up to ${maxDiagrams} diagrams`);
    }
    else {
        features.push('Unlimited diagrams');
    }
    features.push('AI generation for ER and system design diagrams');
    features.push(`Memory context up to ${row.max_memory_messages || 0} messages`);
    if (isPaid) {
        features.push(row.max_collaborators_per_diagram === null
            ? 'Unlimited collaborators per diagram'
            : `Up to ${row.max_collaborators_per_diagram} collaborators per diagram`);
        features.push('Share access and live share edit');
        features.push(row.version_retention_days === null
            ? 'Unlimited version history retention'
            : `Version history retained for ${row.version_retention_days} days`);
        features.push('TypeORM export and advanced SQL targets');
        features.push('Shared-with-me access and active collaborators panel');
    }
    else {
        features.push('Single-user editing and export');
        features.push('SQL export for MySQL and PostgreSQL');
        features.push('No share access, live edit, or version history');
    }
    return {
        id: row.id,
        key: toPlanKey(row.name),
        name: row.name,
        amount_inr: toNumber(row.price),
        max_diagrams: maxDiagrams,
        max_memory_messages: row.max_memory_messages,
        context_window_messages: row.context_window_messages,
        max_collaborators_per_diagram: row.max_collaborators_per_diagram,
        version_retention_days: row.version_retention_days,
        has_collaboration: Boolean(row.has_collaboration),
        has_version_history: Boolean(row.has_version_history),
        is_paid: isPaid,
        description: row.description || '',
        features,
    };
};
const getPlanById = async (planId) => {
    const result = await db_1.pool.query(`SELECT id, name, max_diagrams, max_memory_messages, context_window_messages, max_collaborators_per_diagram, version_retention_days, has_collaboration, has_version_history, price, description
     FROM Plans
     WHERE id = $1`, [planId]);
    if (!result.rows.length) {
        return null;
    }
    return mapPlanRow(result.rows[0]);
};
const getBillingPlans = async (_req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT id, name, max_diagrams, max_memory_messages, context_window_messages, max_collaborators_per_diagram, version_retention_days, has_collaboration, has_version_history, price, description
       FROM Plans
       ORDER BY price ASC, id ASC`);
        const plans = result.rows.map(mapPlanRow);
        return res.status(200).json({ plans });
    }
    catch (error) {
        console.error('Error fetching billing plans:', error.message);
        return res.status(500).json({ message: 'Unable to fetch plans.' });
    }
};
exports.getBillingPlans = getBillingPlans;
const createPaymentLink = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    const { plan_id, preferred_method } = req.body;
    const billingName = typeof req.body?.billing_name === 'string' ? req.body.billing_name.trim() : '';
    const billingEmail = typeof req.body?.billing_email === 'string' ? req.body.billing_email.trim() : '';
    const billingContact = typeof req.body?.billing_contact === 'string' ? req.body.billing_contact.trim() : '';
    const billingAddress = typeof req.body?.billing_address === 'string' ? req.body.billing_address.trim() : '';
    if (!plan_id) {
        return res.status(400).json({ message: 'plan_id is required.' });
    }
    const plan = await getPlanById(plan_id);
    if (!plan || plan.amount_inr <= 0) {
        return res.status(400).json({ message: 'Invalid paid plan selected.' });
    }
    const userResult = await db_1.pool.query('SELECT id, email, username FROM Users WHERE id = $1', [userId]);
    if (!userResult.rows.length) {
        return res.status(404).json({ message: 'User not found.' });
    }
    const user = userResult.rows[0];
    const { keyId, keySecret } = getRazorpayCreds();
    const callbackUrl = `${getFrontendBaseUrl().replace(/\/$/, '')}/billing?payment=success&plan_id=${plan.id}`;
    try {
        const response = await axios_1.default.post('https://api.razorpay.com/v1/payment_links', {
            amount: plan.amount_inr * 100,
            currency: 'INR',
            accept_partial: false,
            description: `${plan.name} plan for Schema.AI`,
            customer: {
                name: billingName || user.username,
                email: billingEmail || user.email,
                ...(billingContact ? { contact: billingContact } : {}),
            },
            notify: {
                email: true,
                sms: false,
            },
            reminder_enable: true,
            callback_url: callbackUrl,
            callback_method: 'get',
            options: {
                checkout: {
                    method: getMethodConfig(preferred_method),
                },
            },
            notes: {
                user_id: String(user.id),
                plan_id: String(plan.id),
                preferred_method: preferred_method || 'card',
                billing_address: billingAddress,
            },
        }, {
            auth: {
                username: keyId,
                password: keySecret,
            },
        });
        return res.status(200).json({
            payment_link_id: response.data.id,
            payment_url: response.data.short_url,
            amount: plan.amount_inr,
            currency: 'INR',
            plan,
        });
    }
    catch (error) {
        console.error('Razorpay create payment link error:', error?.response?.data || error.message);
        return res.status(502).json({
            message: 'Unable to create payment link.',
            details: error?.response?.data || null,
        });
    }
};
exports.createPaymentLink = createPaymentLink;
const getPaymentStatus = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }
    const { payment_link_id } = req.query;
    if (!payment_link_id) {
        return res.status(400).json({ message: 'payment_link_id is required.' });
    }
    const { keyId, keySecret } = getRazorpayCreds();
    try {
        const response = await axios_1.default.get(`https://api.razorpay.com/v1/payment_links/${payment_link_id}`, {
            auth: {
                username: keyId,
                password: keySecret,
            },
        });
        const entity = response.data;
        const notes = entity.notes || {};
        let refreshedToken = null;
        let updatedUser = null;
        if (entity.status === 'paid') {
            const paidUserId = Number(notes.user_id || userId);
            const planId = Number(notes.plan_id || 0);
            const selectedPlan = await getPlanById(planId);
            if (selectedPlan && paidUserId === userId) {
                await db_1.pool.query('UPDATE Users SET plan_id = $1 WHERE id = $2', [selectedPlan.id, userId]);
                const refreshedUserResult = await db_1.pool.query('SELECT id, username, email, plan_id FROM Users WHERE id = $1', [userId]);
                updatedUser = refreshedUserResult.rows[0] || null;
                if (updatedUser) {
                    refreshedToken = generateBillingJwtToken(updatedUser);
                }
            }
        }
        return res.status(200).json({
            id: entity.id,
            status: entity.status,
            amount: entity.amount,
            notes: entity.notes,
            user: updatedUser,
            token: refreshedToken,
        });
    }
    catch (error) {
        console.error('Razorpay get payment status error:', error?.response?.data || error.message);
        return res.status(502).json({ message: 'Unable to fetch payment status.' });
    }
};
exports.getPaymentStatus = getPaymentStatus;
const razorpayWebhook = async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        return res.status(500).json({ message: 'Webhook secret not configured.' });
    }
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
        return res.status(400).json({ message: 'Missing Razorpay signature.' });
    }
    const bodyString = req.rawBody || JSON.stringify(req.body);
    const expectedSignature = crypto_1.default
        .createHmac('sha256', webhookSecret)
        .update(bodyString)
        .digest('hex');
    if (signature !== expectedSignature) {
        return res.status(400).json({ message: 'Invalid webhook signature.' });
    }
    try {
        const event = req.body.event;
        if (event === 'payment_link.paid') {
            const entity = req.body.payload?.payment_link?.entity;
            const notes = entity?.notes || {};
            const userId = Number(notes.user_id);
            const planId = Number(notes.plan_id);
            const plan = await getPlanById(planId);
            if (userId && plan) {
                await db_1.pool.query('UPDATE Users SET plan_id = $1 WHERE id = $2', [plan.id, userId]);
            }
        }
        return res.status(200).json({ received: true });
    }
    catch (error) {
        console.error('Razorpay webhook processing error:', error.message);
        return res.status(500).json({ message: 'Webhook processing failed.' });
    }
};
exports.razorpayWebhook = razorpayWebhook;

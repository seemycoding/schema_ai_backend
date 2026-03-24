import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';

interface BillingPlan {
  id: number;
  key: string;
  name: string;
  amount_inr: number;
  max_diagrams: number | null;
  max_memory_messages: number | null;
  context_window_messages: number | null;
  max_collaborators_per_diagram: number | null;
  version_retention_days: number | null;
  has_collaboration: boolean;
  has_version_history: boolean;
  is_paid: boolean;
  description: string;
  features: string[];
}

interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: string;
  amount: number;
  notes?: Record<string, string>;
}

interface PlanRow {
  id: number;
  name: string;
  max_diagrams: number;
  max_memory_messages: number | null;
  context_window_messages: number | null;
  max_collaborators_per_diagram: number | null;
  version_retention_days: number | null;
  has_collaboration: boolean;
  has_version_history: boolean;
  price: string | number;
  description: string | null;
}

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

const resolveJwtExpiry = (raw: string): string | number => {
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  return raw;
};

const generateBillingJwtToken = (user: { id: number; username: string; email: string; plan_id: number }) => {
  if (!JWT_SECRET) {
    throw new Error('JWT secret is not configured.');
  }

  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, plan_id: user.plan_id },
    JWT_SECRET,
    { expiresIn: resolveJwtExpiry(JWT_EXPIRES_IN) as any }
  );
};

const getFrontendBaseUrl = () => {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
};

const getMethodConfig = (preferredMethod?: 'upi' | 'card' | 'netbanking') => {
  return {
    card: preferredMethod === 'card',
    netbanking: preferredMethod === 'netbanking',
    upi: preferredMethod === 'upi',
    wallet: true,
    emi: false,
    paylater: false,
  };
};

const toNumber = (value: string | number): number => {
  if (typeof value === 'number') {
    return value;
  }
  return Number(value);
};

const toPlanKey = (name: string): string => {
  const key = name.trim().toLowerCase();
  if (!key) {
    return 'custom';
  }
  return key.replace(/\s+/g, '-');
};

const mapPlanRow = (row: PlanRow): BillingPlan => {
  const maxDiagrams = row.max_diagrams >= 0 ? row.max_diagrams : null;
  const isPaid = toNumber(row.price) > 0 || Boolean(row.has_collaboration) || Boolean(row.has_version_history);
  const features: string[] = [];

  if (maxDiagrams !== null) {
    features.push(`Up to ${maxDiagrams} diagrams`);
  } else {
    features.push('Unlimited diagrams');
  }

  features.push('AI generation for ER and system design diagrams');
  features.push(`Memory context up to ${row.max_memory_messages || 0} messages`);

  if (isPaid) {
    features.push(
      row.max_collaborators_per_diagram === null
        ? 'Unlimited collaborators per diagram'
        : `Up to ${row.max_collaborators_per_diagram} collaborators per diagram`
    );
    features.push('Share access and live share edit');
    features.push(
      row.version_retention_days === null
        ? 'Unlimited version history retention'
        : `Version history retained for ${row.version_retention_days} days`
    );
    features.push('TypeORM export and advanced SQL targets');
    features.push('Shared-with-me access and active collaborators panel');
  } else {
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

const getPlanById = async (planId: number): Promise<BillingPlan | null> => {
  const result = await pool.query<PlanRow>(
    `SELECT id, name, max_diagrams, max_memory_messages, context_window_messages, max_collaborators_per_diagram, version_retention_days, has_collaboration, has_version_history, price, description
     FROM Plans
     WHERE id = $1`,
    [planId]
  );

  if (!result.rows.length) {
    return null;
  }

  return mapPlanRow(result.rows[0]);
};

export const getBillingPlans = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<PlanRow>(
      `SELECT id, name, max_diagrams, max_memory_messages, context_window_messages, max_collaborators_per_diagram, version_retention_days, has_collaboration, has_version_history, price, description
       FROM Plans
       ORDER BY price ASC, id ASC`
    );

    const plans = result.rows.map(mapPlanRow);
    return res.status(200).json({ plans });
  } catch (error: any) {
    console.error('Error fetching billing plans:', error.message);
    return res.status(500).json({ message: 'Unable to fetch plans.' });
  }
};

export const createPaymentLink = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const { plan_id, preferred_method } = req.body as {
    plan_id?: number;
    preferred_method?: 'upi' | 'card' | 'netbanking';
    billing_name?: string;
    billing_email?: string;
    billing_contact?: string;
    billing_address?: string;
  };
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

  const userResult = await pool.query(
    'SELECT id, email, username FROM Users WHERE id = $1',
    [userId]
  );

  if (!userResult.rows.length) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const user = userResult.rows[0];
  const { keyId, keySecret } = getRazorpayCreds();

  const callbackUrl = `${getFrontendBaseUrl().replace(/\/$/, '')}/billing?payment=success&plan_id=${plan.id}`;

  try {
    const response = await axios.post<RazorpayPaymentLink>(
      'https://api.razorpay.com/v1/payment_links',
      {
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
      },
      {
        auth: {
          username: keyId,
          password: keySecret,
        },
      }
    );

    return res.status(200).json({
      payment_link_id: response.data.id,
      payment_url: response.data.short_url,
      amount: plan.amount_inr,
      currency: 'INR',
      plan,
    });
  } catch (error: any) {
    console.error('Razorpay create payment link error:', error?.response?.data || error.message);
    return res.status(502).json({
      message: 'Unable to create payment link.',
      details: error?.response?.data || null,
    });
  }
};

export const getPaymentStatus = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  const { payment_link_id } = req.query as { payment_link_id?: string };
  if (!payment_link_id) {
    return res.status(400).json({ message: 'payment_link_id is required.' });
  }

  const { keyId, keySecret } = getRazorpayCreds();

  try {
    const response = await axios.get<RazorpayPaymentLink>(`https://api.razorpay.com/v1/payment_links/${payment_link_id}`, {
      auth: {
        username: keyId,
        password: keySecret,
      },
    });

    const entity = response.data;
    const notes = entity.notes || {};

    let refreshedToken: string | null = null;
    let updatedUser: { id: number; username: string; email: string; plan_id: number } | null = null;

    if (entity.status === 'paid') {
      const paidUserId = Number(notes.user_id || userId);
      const planId = Number(notes.plan_id || 0);
      const selectedPlan = await getPlanById(planId);

      if (selectedPlan && paidUserId === userId) {
        await pool.query('UPDATE Users SET plan_id = $1 WHERE id = $2', [selectedPlan.id, userId]);
        const refreshedUserResult = await pool.query<{ id: number; username: string; email: string; plan_id: number }>(
          'SELECT id, username, email, plan_id FROM Users WHERE id = $1',
          [userId]
        );
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
  } catch (error: any) {
    console.error('Razorpay get payment status error:', error?.response?.data || error.message);
    return res.status(502).json({ message: 'Unable to fetch payment status.' });
  }
};

export const razorpayWebhook = async (req: Request, res: Response) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({ message: 'Webhook secret not configured.' });
  }

  const signature = req.headers['x-razorpay-signature'] as string | undefined;
  if (!signature) {
    return res.status(400).json({ message: 'Missing Razorpay signature.' });
  }

  const bodyString = (req as any).rawBody || JSON.stringify(req.body);
  const expectedSignature = crypto
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
        await pool.query('UPDATE Users SET plan_id = $1 WHERE id = $2', [plan.id, userId]);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Razorpay webhook processing error:', error.message);
    return res.status(500).json({ message: 'Webhook processing failed.' });
  }
};

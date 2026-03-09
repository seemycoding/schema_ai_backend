import { pool } from '../config/db';

export interface PlanFeatures {
  plan_id: number;
  plan_name: string;
  max_diagrams: number | null;
  max_memory_messages: number;
  context_window_messages: number;
  has_collaboration: boolean;
  has_version_history: boolean;
  price: number;
  is_paid: boolean;
}

interface UserPlanRow {
  user_plan_id: number;
  plan_name: string | null;
  max_diagrams: number | null;
  max_memory_messages: number | null;
  context_window_messages: number | null;
  has_collaboration: boolean | null;
  has_version_history: boolean | null;
  price: string | number | null;
}

const FALLBACK_PLAN_FEATURES: Record<number, PlanFeatures> = {
  1: {
    plan_id: 1,
    plan_name: 'Free',
    max_diagrams: 6,
    max_memory_messages: 20,
    context_window_messages: 12,
    has_collaboration: false,
    has_version_history: false,
    price: 0,
    is_paid: false,
  },
  2: {
    plan_id: 2,
    plan_name: 'Pro',
    max_diagrams: null,
    max_memory_messages: 200,
    context_window_messages: 80,
    has_collaboration: true,
    has_version_history: true,
    price: 19,
    is_paid: true,
  },
  3: {
    plan_id: 3,
    plan_name: 'Team',
    max_diagrams: null,
    max_memory_messages: 200,
    context_window_messages: 80,
    has_collaboration: true,
    has_version_history: true,
    price: 49,
    is_paid: true,
  },
  4: {
    plan_id: 4,
    plan_name: 'Free',
    max_diagrams: 6,
    max_memory_messages: 20,
    context_window_messages: 12,
    has_collaboration: false,
    has_version_history: false,
    price: 0,
    is_paid: false,
  },
};

const toNumber = (value: string | number | null): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
};

const getFallbackPlanFeatures = (planId: number): PlanFeatures => {
  return FALLBACK_PLAN_FEATURES[planId] || FALLBACK_PLAN_FEATURES[4];
};

export const getPlanFeaturesForUser = async (
  userId: number,
  tokenPlanId?: number
): Promise<PlanFeatures> => {
  const result = await pool.query<UserPlanRow>(
    `SELECT
      u.plan_id AS user_plan_id,
      p.name AS plan_name,
      p.max_diagrams,
      p.max_memory_messages,
      p.context_window_messages,
      p.has_collaboration,
      p.has_version_history,
      p.price
    FROM Users u
    LEFT JOIN Plans p ON p.id = u.plan_id
    WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return getFallbackPlanFeatures(tokenPlanId || 4);
  }

  const row = result.rows[0];

  if (row.plan_name) {
    const maxDiagrams =
      row.max_diagrams !== null && row.max_diagrams >= 0 ? row.max_diagrams : null;
    const maxMemoryMessages =
      row.max_memory_messages !== null && row.max_memory_messages > 0
        ? row.max_memory_messages
        : getFallbackPlanFeatures(row.user_plan_id || tokenPlanId || 4).max_memory_messages;
    const contextWindowMessages =
      row.context_window_messages !== null && row.context_window_messages > 0
        ? row.context_window_messages
        : getFallbackPlanFeatures(row.user_plan_id || tokenPlanId || 4).context_window_messages;
    const hasCollaboration = Boolean(row.has_collaboration);
    const hasVersionHistory = Boolean(row.has_version_history);
    const price = toNumber(row.price);

    return {
      plan_id: row.user_plan_id,
      plan_name: row.plan_name,
      max_diagrams: maxDiagrams,
      max_memory_messages: maxMemoryMessages,
      context_window_messages: contextWindowMessages,
      has_collaboration: hasCollaboration,
      has_version_history: hasVersionHistory,
      price,
      is_paid: price > 0 || hasCollaboration || hasVersionHistory,
    };
  }

  return getFallbackPlanFeatures(row.user_plan_id || tokenPlanId || 4);
};

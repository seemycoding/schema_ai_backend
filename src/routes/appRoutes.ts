import express from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  saveSchema,
  getSchemas,
  updateSchema,
  getSchemaUsage,
  getSchemaVersions,
  getSchemaVersionDetails,
} from '../controllers/schemaController';
import { generateDiagram } from '../controllers/aiController';
import { deleteProfile, getProfile } from '../controllers/profileController';
import { getSharedWithMeSchemas, registerShareLinkAccess, sendShareInvites } from '../controllers/shareController';
import { getSchemaChatHistory, upsertSchemaChatMessage } from '../controllers/chatController';
const router = express.Router();


router.post('/schemas', authMiddleware, saveSchema);
router.get('/schemas', authMiddleware, getSchemas);
router.get('/schemas/usage', authMiddleware, getSchemaUsage);
router.put('/schemas/:id', authMiddleware, updateSchema);
router.get('/schemas/:id/versions', authMiddleware, getSchemaVersions);
router.get('/schemas/:id/versions/:versionId', authMiddleware, getSchemaVersionDetails);
router.post('/ai/generate-diagram', authMiddleware, generateDiagram);
router.post('/share/invite', authMiddleware, sendShareInvites);
router.post('/share/register-link', authMiddleware, registerShareLinkAccess);
router.get('/schemas/shared-with-me', authMiddleware, getSharedWithMeSchemas);
router.get('/schemas/:id/chat-history', authMiddleware, getSchemaChatHistory);
router.post('/schemas/:id/chat-history', authMiddleware, upsertSchemaChatMessage);
router.get('/profile', authMiddleware, getProfile);
router.delete('/profile', authMiddleware, deleteProfile);

export default router;

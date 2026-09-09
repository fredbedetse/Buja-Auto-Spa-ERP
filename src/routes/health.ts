import { Router } from 'express';
import prisma from '../lib/prisma';

const router = Router();

router.get('/', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      version: '1.0.0',
      service: 'Buja Auto Spa ERP API',
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: 'Database connection failed',
    });
  }
});

router.get('/sync-check', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    const syncLogCount = await prisma.syncLog.count();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      stats: {
        users: userCount,
        syncLogs: syncLogCount,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

export default router;

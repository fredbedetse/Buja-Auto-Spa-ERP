import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Settings (Phase 14) - two scopes:
//   * global   : company identity + default locale (edited with settings:manage)
//   * personal : theme / currency / language / motion, one row per user
// Plus the "who runs this place" panel: promote/demote ADMIN with guardrails.
// Global rows use the sentinel userId 'GLOBAL'; values are JSON blobs under
// fixed keys so a partial update never races another tab into lost writes.
// ---------------------------------------------------------------------------

export const GLOBAL_SCOPE = 'GLOBAL';
export const GLOBAL_KEYS = ['companyName', 'location', 'defaultCurrency', 'defaultLanguage'] as const;
export const PERSONAL_KEYS = ['theme', 'currency', 'language', 'reduceMotion'] as const;
export const LOCKED_LOCATION = 'Bujumbura, Burundi';

const DEFAULT_GLOBAL = { companyName: 'Buja Auto Spa', location: LOCKED_LOCATION, defaultCurrency: 'bif', defaultLanguage: 'en' };

const router = Router();

// GET /api/settings/brand - public: the login screen shows the company name
router.get('/brand', async (_req, res) => {
  try {
    const row = await prisma.appSetting.findFirst({ where: { key: 'companyName', userId: GLOBAL_SCOPE }, select: { value: true } });
    let name = DEFAULT_GLOBAL.companyName as string;
    if (row) { try { name = JSON.parse(row.value); } catch { name = row.value; } }
    res.json({ companyName: name, location: LOCKED_LOCATION });
  } catch (e) { console.error('brand error:', e); res.json({ companyName: DEFAULT_GLOBAL.companyName, location: LOCKED_LOCATION }); }
});

router.use(authenticate);

async function readScope(userId: string) {
  const rows = await prisma.appSetting.findMany({ where: { userId } });
  const out: Record<string, any> = {};
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
  return out;
}
async function writeScope(userId: string, patch: Record<string, any>, actorId?: string) {
  for (const [key, value] of Object.entries(patch)) {
    await prisma.appSetting.upsert({
      where: { key_userId: { key, userId } },
      create: { key, userId, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value), version: { increment: 1 } },
    });
  }
  await prisma.auditLog.create({ data: { userId: actorId, action: 'SETTING_UPDATE', entityType: 'AppSetting', entityId: userId, newData: JSON.stringify(patch), } as any });
}

// GET /api/settings - merged view for the current user
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const [globalRaw, personal] = await Promise.all([readScope(GLOBAL_SCOPE), readScope(req.user!.userId)]);
    const isAdmin = !!(req.user as any)?.roles?.includes?.('ADMIN') || !!(req.user as any)?.roles?.includes?.('SUPER_ADMIN');
    const canManage = await canManageSettings(req.user!.userId);
    res.json({
      global: { ...DEFAULT_GLOBAL, ...globalRaw },
      personal,
      canManage,
      localeDefaultsApplied: Object.keys(personal).length === 0,
      me: { id: req.user!.userId, roles: (req.user as any)?.roles ?? [] },
    });
  } catch (e) { console.error('settings get error:', e); res.status(500).json({ error: 'Failed to read settings' }); }
});

async function canManageSettings(userId: string): Promise<boolean> {
  const perms = await prisma.userRole.findMany({
    where: { userId, role: { permissions: { some: { permission: { key: 'settings:manage' } } } } },
    select: { roleId: true }, take: 1,
  });
  return perms.length > 0;
}

const personalPatch = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  currency: z.enum(['bif', 'usd']).optional(),
  language: z.enum(['en', 'fr']).optional(),
  reduceMotion: z.boolean().optional(),
}).refine(o => Object.keys(o).length > 0, { message: 'Empty patch' });

// PUT /api/settings/personal - own preferences; any authenticated user
router.put('/personal', async (req: AuthenticatedRequest, res) => {
  try {
    const d = personalPatch.parse(req.body);
    await writeScope(req.user!.userId, d, req.user!.userId);
    res.json({ ok: true, personal: await readScope(req.user!.userId) });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', issues: e.issues?.slice(0, 3) });
    console.error('settings personal error:', e); res.status(500).json({ error: 'Failed to save preferences' });
  }
});

const globalPatch = z.object({
  companyName: z.string().trim().min(2).max(120).optional(),
  location: z.string().trim().optional(),
  defaultCurrency: z.enum(['bif', 'usd']).optional(),
  defaultLanguage: z.enum(['en', 'fr']).optional(),
}).refine(o => Object.keys(o).length > 0, { message: 'Empty patch' });

// PUT /api/settings/global - company-wide. The shop does not move. Ever.
router.put('/global', authorize(['settings:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const d = globalPatch.parse(req.body);
    if (d.location !== undefined && d.location !== LOCKED_LOCATION) {
      return res.status(400).json({ error: 'The workshop stays in Bujumbura. Location is part of the brand.', code: 'LOCATION_LOCKED' });
    }
    delete (d as any).location;
    await writeScope(GLOBAL_SCOPE, d as any, req.user!.userId);
    res.json({ ok: true, global: { ...DEFAULT_GLOBAL, ...await readScope(GLOBAL_SCOPE) } });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', issues: e.issues?.slice(0, 3) });
    console.error('settings global error:', e); res.status(500).json({ error: 'Failed to save company settings' });
  }
});

// GET /api/settings/admins - everyone on the roster with an admin flag
router.get('/admins', authorize(['settings:read', 'settings:manage']), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { isDeleted: false },
      select: { id: true, firstName: true, lastName: true, email: true, username: true, status: true, updatedAt: true,
        roles: { select: { role: { select: { name: true } } } } },
      orderBy: [{ createdAt: 'asc' }],
    });
    const data = users.map(u => {
      const names = u.roles.map(r => r.role.name);
      return {
        id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email, username: u.username,
        status: u.status, lastSeen: u.updatedAt, roles: names,
        isSuper: names.includes('SUPER_ADMIN'), isAdmin: names.includes('ADMIN'),
      };
    });
    res.json({ data, adminCount: data.filter(x => x.isAdmin || x.isSuper).length });
  } catch (e) { console.error('admins list error:', e); res.status(500).json({ error: 'Failed to list members' }); }
});

// PATCH /api/settings/admins/:userId {admin:true|false} - crown out, crown off
router.patch('/admins/:userId', authorize(['settings:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const { admin } = z.object({ admin: z.boolean() }).parse(req.body);
    const target = await prisma.user.findFirst({
      where: { id: req.params.userId, isDeleted: false },
      include: { roles: { include: { role: true } } },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });
    const names = target.roles.map(r => r.role.name);
    if (names.includes('SUPER_ADMIN')) return res.status(403).json({ error: 'The owner seat is not grantable or revocable here.', code: 'OWNER_LOCKED' });
    const already = names.includes('ADMIN');
    if (already === admin) return res.json({ ok: true, unchanged: true, admin });
    if (!admin) {
      if (target.id === req.user!.userId) return res.status(400).json({ error: 'You cannot revoke your own admin access - ask another admin.', code: 'SELF_DEMOTE' });
      const admins = await prisma.userRole.count({ where: { role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] as any } }, user: { isDeleted: false, status: 'ACTIVE' } } as any });
      if (already && admins <= 1) return res.status(400).json({ error: 'That is the last active admin. Promote someone first.', code: 'LAST_ADMIN' });
    }
    const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
    if (!adminRole) return res.status(500).json({ error: 'ADMIN role missing' });
    if (admin) {
      await prisma.userRole.create({ data: { userId: target.id, roleId: adminRole.id, assignedBy: req.user!.userId } });
    } else {
      await prisma.userRole.deleteMany({ where: { userId: target.id, roleId: adminRole.id } });
    }
    await prisma.auditLog.create({ data: { userId: req.user!.userId, action: admin ? 'USER_ADMIN_GRANT' : 'USER_ADMIN_REVOKE', entityType: 'User', entityId: target.id, newData: JSON.stringify({ admin }) } as any });
    res.json({ ok: true, admin, user: { id: target.id, name: `${target.firstName} ${target.lastName}` } });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed' });
    console.error('admin grant error:', e); res.status(500).json({ error: 'Failed to update admin status' });
  }
});

export default router;

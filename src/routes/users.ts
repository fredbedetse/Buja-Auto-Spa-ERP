import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, authorizeRoles, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  roles: z.array(z.string()).min(1),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).max(30).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  avatarUrl: z.string().optional(),
  roles: z.array(z.string()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  version: z.number().int().optional(), // For optimistic locking
});

// GET /api/users - List users
router.get('/', authorize(['users:read', 'users:manage']), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;

    const skip = (page - 1) * limit;

    const where: any = {
      isDeleted: false,
    };

    if (search) {
      where.OR = [
        { email: { contains: search } },
        { username: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          phone: true,
          avatarUrl: true,
          status: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          lastSyncedAt: true,
          roles: {
            include: { role: true }
          }
        }
      }),
      prisma.user.count({ where })
    ]);

    const formatted = users.map(u => ({
      ...u,
      roles: u.roles.map(ur => ({
        id: ur.role.id,
        name: ur.role.name,
        displayName: ur.role.displayName,
      }))
    }));

    res.json({
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/:id
router.get('/:id', authorize(['users:read', 'users:manage']), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        lastSyncedAt: true,
        isDeleted: true,
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } }
        }
      }
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ...user,
      roles: user.roles.map(ur => ({
        id: ur.role.id,
        name: ur.role.name,
        displayName: ur.role.displayName,
        permissions: ur.role.permissions.map(rp => rp.permission.key)
      })),
      permissions: Array.from(new Set(user.roles.flatMap(ur => ur.role.permissions.map(rp => rp.permission.key))))
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST /api/users
router.post('/', authorizeRoles(['SUPER_ADMIN', 'ADMIN']), authorize(['users:create', 'users:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { email, username, password, firstName, lastName, phone, roles, status } = parsed.data;

    // Check existing
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
        isDeleted: false,
      }
    });

    if (existing) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    // Validate roles exist
    const roleRecords = await prisma.role.findMany({
      where: { name: { in: roles as any } }
    });

    if (roleRecords.length !== roles.length) {
      return res.status(400).json({ error: 'One or more roles not found' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        firstName,
        lastName,
        phone,
        status: status as any || 'ACTIVE',
        deviceId: req.user?.deviceId,
        roles: {
          create: roleRecords.map(r => ({
            roleId: r.id,
            assignedBy: req.user?.userId,
          }))
        }
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: req.user?.deviceId || 'unknown',
        entityType: 'User',
        entityId: user.id,
        operation: 'CREATE',
        status: 'SYNCED',
        version: user.version,
        syncedAt: new Date(),
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user?.userId,
        action: 'user.create',
        entityType: 'User',
        entityId: user.id,
        newData: JSON.stringify(user),
        ipAddress: req.ip,
        deviceId: req.user?.deviceId,
      }
    });

    res.status(201).json(user);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id
router.put('/:id', authorize(['users:update', 'users:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!existing || existing.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Optimistic locking check
    if (parsed.data.version !== undefined && parsed.data.version !== existing.version) {
      return res.status(409).json({
        error: 'Conflict: record has been modified by another user',
        code: 'VERSION_CONFLICT',
        serverVersion: existing.version,
        clientVersion: parsed.data.version,
        serverData: existing,
      });
    }

    const { roles, version, ...updateData } = parsed.data;

    // Check email/username uniqueness if changing
    if (updateData.email || updateData.username) {
      const conflict = await prisma.user.findFirst({
        where: {
          id: { not: existing.id },
          OR: [
            ...(updateData.email ? [{ email: updateData.email }] : []),
            ...(updateData.username ? [{ username: updateData.username }] : []),
          ],
          isDeleted: false,
        }
      });
      if (conflict) {
        return res.status(409).json({ error: 'Email or username already exists' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update user
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: {
          ...updateData,
          version: { increment: 1 },
          lastSyncedAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          phone: true,
          avatarUrl: true,
          status: true,
          version: true,
          createdAt: true,
          updatedAt: true,
        }
      });

      // Update roles if provided
      if (roles) {
        const roleRecords = await tx.role.findMany({
          where: { name: { in: roles as any } }
        });

        if (roleRecords.length !== roles.length) {
          throw new Error('One or more roles not found');
        }

        // Delete existing and recreate
        await tx.userRole.deleteMany({ where: { userId: existing.id } });
        await tx.userRole.createMany({
          data: roleRecords.map(r => ({
            userId: existing.id,
            roleId: r.id,
            assignedBy: req.user?.userId,
          }))
        });
      }

      await tx.syncLog.create({
        data: {
          userId: req.user?.userId,
          deviceId: req.user?.deviceId || 'unknown',
          entityType: 'User',
          entityId: updated.id,
          operation: 'UPDATE',
          status: 'SYNCED',
          version: updated.version,
          clientVersion: version,
          serverVersion: existing.version,
          syncedAt: new Date(),
        }
      });

      return updated;
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user?.userId,
        action: 'user.update',
        entityType: 'User',
        entityId: result.id,
        oldData: JSON.stringify(existing),
        newData: JSON.stringify(result),
        ipAddress: req.ip,
        deviceId: req.user?.deviceId,
      }
    });

    res.json(result);
  } catch (error: any) {
    console.error('Update user error:', error);
    if (error.message === 'One or more roles not found') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id (soft delete)
router.delete('/:id', authorizeRoles(['SUPER_ADMIN', 'ADMIN']), authorize(['users:delete', 'users:manage']), async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (existing.id === req.user?.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        isDeleted: true,
        status: 'INACTIVE',
        version: { increment: 1 },
      }
    });

    // Revoke sessions
    await prisma.session.updateMany({
      where: { userId: existing.id },
      data: { isRevoked: true }
    });

    await prisma.syncLog.create({
      data: {
        userId: req.user?.userId,
        deviceId: req.user?.deviceId || 'unknown',
        entityType: 'User',
        entityId: updated.id,
        operation: 'DELETE',
        status: 'SYNCED',
        version: updated.version,
        syncedAt: new Date(),
      }
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /api/users/roles/list
router.get('/roles/list', authorize(['users:read', 'users:manage']), async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      where: { isDeleted: false },
      include: {
        permissions: { include: { permission: true } }
      },
      orderBy: { displayName: 'asc' }
    });

    res.json(roles.map(r => ({
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map(rp => ({
        key: rp.permission.key,
        module: rp.permission.module,
        action: rp.permission.action,
        description: rp.permission.description,
      }))
    })));
  } catch (error) {
    console.error('List roles error:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

export default router;

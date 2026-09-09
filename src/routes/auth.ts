import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../lib/jwt';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or username required'), // email or username
  password: z.string().min(1, 'Password required'),
  deviceId: z.string().optional(),
  deviceInfo: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().optional(),
});

// Helper to get user roles and permissions
async function getUserRolesAndPermissions(userId: string) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true }
          }
        }
      }
    }
  });

  const roles = userRoles.map(ur => ur.role.name);
  const permissions = Array.from(
    new Set(
      userRoles.flatMap(ur => 
        ur.role.permissions.map(rp => rp.permission.key)
      )
    )
  );

  return { roles, permissions };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { identifier, password, deviceId, deviceInfo } = parsed.data;

    // Find user by email or username
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: identifier }
        ],
        isDeleted: false,
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(401).json({ error: `Account is ${user.status.toLowerCase()}` });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get roles and permissions
    const { roles, permissions } = await getUserRolesAndPermissions(user.id);

    // Create session
    const sessionId = uuidv4();
    const refreshToken = generateRefreshToken({
      userId: user.id,
      sessionId,
      deviceId,
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshToken,
        deviceId,
        deviceInfo,
        ipAddress: req.ip,
        expiresAt,
      }
    });

    // Generate access token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      username: user.username,
      roles,
      permissions,
      sessionId,
      deviceId,
    });

    // Update last synced
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSyncedAt: new Date() }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'user.login',
        ipAddress: req.ip,
        deviceId,
      }
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        status: user.status,
        roles,
        permissions,
        version: user.version,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      accessToken,
      refreshToken,
      sessionId,
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { refreshToken, deviceId } = parsed.data;

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true }
    });

    if (!session || session.isRevoked || session.refreshToken !== refreshToken) {
      return res.status(401).json({ error: 'Session not found or revoked' });
    }

    if (session.expiresAt < new Date()) {
      await prisma.session.update({
        where: { id: session.id },
        data: { isRevoked: true }
      });
      return res.status(401).json({ error: 'Session expired' });
    }

    if (session.user.isDeleted || session.user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'User account inactive' });
    }

    // Update last used
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() }
    });

    const { roles, permissions } = await getUserRolesAndPermissions(session.userId);

    const newAccessToken = generateAccessToken({
      userId: session.userId,
      email: session.user.email,
      username: session.user.username,
      roles,
      permissions,
      sessionId: session.id,
      deviceId: deviceId || session.deviceId || undefined,
    });

    // Optionally rotate refresh token
    const newRefreshToken = generateRefreshToken({
      userId: session.userId,
      sessionId: session.id,
      deviceId: deviceId || session.deviceId || undefined,
    });

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        lastUsedAt: new Date(),
      }
    });

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: session.user.id,
        email: session.user.email,
        username: session.user.username,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        roles,
        permissions,
      }
    });

  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const sessionId = req.user?.sessionId;
    if (sessionId) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { isRevoked: true }
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user?.userId,
        action: 'user.logout',
        ipAddress: req.ip,
        deviceId: req.user?.deviceId,
      }
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
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

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { roles, permissions } = await getUserRolesAndPermissions(userId!);

    res.json({
      ...user,
      roles,
      permissions,
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });

    const hashed = await bcrypt.hash(parsed.data.newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashed,
        version: { increment: 1 },
      }
    });

    // Revoke all other sessions
    await prisma.session.updateMany({
      where: {
        userId: user.id,
        id: { not: req.user!.sessionId }
      },
      data: { isRevoked: true }
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../lib/jwt';
import prisma from '../lib/prisma';

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7);
    if (!token) {
      return res.status(401).json({ error: 'Missing access token' });
    }

    const payload = verifyAccessToken(token);

    // Check if session is still valid
    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Session expired or revoked' });
    }

    // Check user status
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { status: true, isDeleted: true },
    });

    if (!user || user.isDeleted || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'User account is inactive or deleted' });
    }

    req.user = payload;
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid access token', code: 'INVALID_TOKEN' });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

export function authorize(requiredPermissions: string[] | string, requireAll: boolean = false) {
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Super admin bypass
    if (req.user.roles.includes('SUPER_ADMIN')) {
      return next();
    }

    const userPermissions = req.user.permissions || [];

    if (requireAll) {
      const hasAll = permissions.every(p => userPermissions.includes(p));
      if (!hasAll) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          required: permissions,
          missing: permissions.filter(p => !userPermissions.includes(p))
        });
      }
    } else {
      const hasOne = permissions.some(p => userPermissions.includes(p));
      if (!hasOne) {
        return res.status(403).json({ 
          error: 'Insufficient permissions',
          required: permissions
        });
      }
    }

    next();
  };
}

export function authorizeRoles(requiredRoles: string[] | string) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.user.roles.includes('SUPER_ADMIN')) {
      return next();
    }

    const hasRole = roles.some(r => req.user!.roles.includes(r));
    if (!hasRole) {
      return res.status(403).json({ 
        error: 'Insufficient role',
        required: roles,
        current: req.user.roles
      });
    }

    next();
  };
}

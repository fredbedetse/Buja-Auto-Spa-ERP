import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import { ENV } from '../config/env';

const JWT_SECRET = ENV.jwtSecret;
const JWT_REFRESH_SECRET = ENV.jwtRefreshSecret;
const JWT_EXPIRES_IN = ENV.accessTtl;
const JWT_REFRESH_EXPIRES_IN = ENV.refreshTtl;

export interface AccessTokenPayload {
  userId: string;
  email: string;
  username: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
  deviceId?: string;
  jti: string;
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId: string;
  deviceId?: string;
  jti: string;
}

export function generateAccessToken(payload: Omit<AccessTokenPayload, 'jti'>): string {
  return jwt.sign({ ...payload, jti: uuidv4() }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function generateRefreshToken(payload: Omit<RefreshTokenPayload, 'jti'>): string {
  return jwt.sign({ ...payload, jti: uuidv4() }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export function decodeToken(token: string): any {
  return jwt.decode(token);
}

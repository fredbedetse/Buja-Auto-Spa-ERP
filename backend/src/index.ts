import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ENV, productionConfigIssues } from './config/env';
import { log } from './lib/log';
import cors from 'cors';
import prisma from './lib/prisma';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import customersRoutes from './routes/customers';
import inventoryRoutes from './routes/inventory';
import salesRoutes from './routes/sales';
import suppliersRoutes from './routes/suppliers';
import purchasesRoutes from './routes/purchases';
import vehiclesRoutes from './routes/vehicles';
import employeesRoutes from './routes/employees';
import paymentsRoutes from './routes/payments';
import carwashRouter from './routes/carwash';
import maintenanceRouter from './routes/maintenance';
import rentalsRouter from './routes/rentals';
import reportsRouter from './routes/reports';
import expensesRouter from './routes/expenses';
import settingsRouter from './routes/settings';
import payrollRouter from './routes/payroll';
import invoicesRoutes from './routes/invoices';
import syncRoutes from './routes/sync';
import healthRoutes from './routes/health';

const app = express();
const PORT = ENV.port;

if (ENV.trustProxy) app.set('trust proxy', 1); // behind nginx/compose

// Security headers. CSP only in production (Vite dev needs inline/HMR freedom).
app.use(helmet({
  contentSecurityPolicy: ENV.isProd ? {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'connect-src': ["'self'", ...(process.env.API_PUBLIC_ORIGIN ? [process.env.API_PUBLIC_ORIGIN] : [])],
      'frame-ancestors': ["'none'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

log('info', '🚀 Starting Buja Auto Spa ERP Backend...', { env: ENV.node, port: PORT, cors: ENV.corsOrigins });

// Middleware
app.use(cors({
  origin: ENV.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Client-Version'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (ENV.jsonLogs) log('info', 'http', { m: req.method, u: req.originalUrl, s: res.statusCode, ms: duration, ip: req.ip });
    else console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Rate limiting: login-family is the crown-jewel endpoint, keep it tight in prod.
const authLimiter = rateLimit({
  windowMs: ENV.authRateWindowMs,
  limit: ENV.authRateMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/me' || req.path === '/logout',
  message: { error: 'Too many attempts - try again later', code: 'RATE_LIMITED' },
});
const globalLimiter = rateLimit({
  windowMs: ENV.globalRateWindowMs,
  limit: ENV.globalRateMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/health'),
  message: { error: 'Rate limit reached', code: 'RATE_LIMITED' },
});
app.use('/api/auth', authLimiter);
app.use('/api', globalLimiter);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/carwash', carwashRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/rentals', rentalsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/sync', syncRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Buja Auto Spa ERP API',
    version: '1.0.0',
    description: 'Offline-first ERP for Buja Auto Spa - Truck parts, maintenance, rentals, car wash',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      customers: '/api/customers',
      inventory: '/api/inventory',
      sales: '/api/sales',
      suppliers: '/api/suppliers',
      purchases: '/api/purchases',
      vehicles: '/api/vehicles',
      sync: '/api/sync',
    },
    features: {
      offlineFirst: true,
      pwaReady: true,
      syncEngine: true,
      rbac: true,
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: ['/api/health', '/api/auth', '/api/users', '/api/customers', '/api/inventory', '/api/sales', '/api/suppliers', '/api/purchases', '/api/vehicles', '/api/employees', '/api/payments', '/api/invoices', '/api/carwash', '/api/maintenance', '/api/rentals', '/api/reports', '/api/expenses', '/api/settings', '/api/payroll', '/api/sync'],
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function start() {
  try {
    const issues = productionConfigIssues();

    if (issues.length) {
      console.error('\n❌ Refusing to start in production with unsafe configuration:\n');
      issues.forEach(x => console.error('   • ' + x));
      console.error('\n   (Development mode ignores these guards. See DEPLOYMENT.md.)\n');
      process.exit(1);
    }

    await prisma.$connect();
    console.log('✅ Database connected');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📚 API Docs: http://localhost:${PORT}/`);
      console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
      console.log('');

      if (!ENV.isProd) {
        console.log('🔐 Default credentials:');
        console.log('   Super Admin: admin@bujaautospa.bi / Admin@123456');
        console.log('   Manager: manager@bujaautospa.bi / Manager@123');
        console.log('');
      } else {
        log(
          'warn',
          'production mode: demo credentials banner suppressed - rotate all seeded passwords (deploy docs)'
        );
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

start();

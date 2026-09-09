import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
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
import invoicesRoutes from './routes/invoices';
import syncRoutes from './routes/sync';
import healthRoutes from './routes/health';

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

console.log('🚀 Starting Buja Auto Spa ERP Backend...');
console.log(`📊 Environment: ${process.env.NODE_ENV}`);
console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);

// Middleware
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'],
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
    console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

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
    availableEndpoints: ['/api/health', '/api/auth', '/api/users', '/api/customers', '/api/inventory', '/api/sales', '/api/suppliers', '/api/purchases', '/api/vehicles', '/api/employees', '/api/payments', '/api/invoices', '/api/carwash', '/api/maintenance', '/api/sync'],
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
    // Test DB connection
    await prisma.$connect();
    console.log('✅ Database connected');

    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
      console.log(`📚 API Docs: http://localhost:${PORT}/`);
      console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
      console.log('');
      console.log('🔐 Default credentials:');
      console.log('   Super Admin: admin@bujaautospa.bi / Admin@123456');
      console.log('   Manager: manager@bujaautospa.bi / Manager@123');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

start();

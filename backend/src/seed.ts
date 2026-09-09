import bcrypt from 'bcryptjs';
import prisma from './lib/prisma';

async function seed() {
  console.log('🌱 Starting Buja Auto Spa ERP seed...');

  // Create permissions
  const permissionDefs = [
    // Users
    { key: 'users:read', module: 'users', action: 'read', description: 'View users' },
    { key: 'users:create', module: 'users', action: 'create', description: 'Create users' },
    { key: 'users:update', module: 'users', action: 'update', description: 'Update users' },
    { key: 'users:delete', module: 'users', action: 'delete', description: 'Delete users' },
    { key: 'users:manage', module: 'users', action: 'manage', description: 'Full users management' },
    
    // Dashboard
    { key: 'dashboard:read', module: 'dashboard', action: 'read', description: 'View dashboard' },
    
    // Customers
    { key: 'customers:read', module: 'customers', action: 'read', description: 'View customers' },
    { key: 'customers:create', module: 'customers', action: 'create', description: 'Create customers' },
    { key: 'customers:update', module: 'customers', action: 'update', description: 'Update customers' },
    { key: 'customers:delete', module: 'customers', action: 'delete', description: 'Delete customers' },
    { key: 'customers:manage', module: 'customers', action: 'manage', description: 'Full customers management' },
    
    // Suppliers
    { key: 'suppliers:read', module: 'suppliers', action: 'read', description: 'View suppliers' },
    { key: 'suppliers:manage', module: 'suppliers', action: 'manage', description: 'Manage suppliers' },
    
    // Vehicles
    { key: 'vehicles:read', module: 'vehicles', action: 'read', description: 'View vehicles' },
    { key: 'vehicles:manage', module: 'vehicles', action: 'manage', description: 'Manage vehicles' },
    
    // Inventory
    { key: 'inventory:read', module: 'inventory', action: 'read', description: 'View inventory' },
    { key: 'inventory:manage', module: 'inventory', action: 'manage', description: 'Manage inventory' },
    
    // Sales
    { key: 'sales:read', module: 'sales', action: 'read', description: 'View sales' },
    { key: 'sales:create', module: 'sales', action: 'create', description: 'Create sales' },
    { key: 'sales:manage', module: 'sales', action: 'manage', description: 'Manage sales' },
    
    // Purchases
    { key: 'purchases:read', module: 'purchases', action: 'read', description: 'View purchases' },
    { key: 'purchases:manage', module: 'purchases', action: 'manage', description: 'Manage purchases' },
    
    // Invoices
    { key: 'invoices:read', module: 'invoices', action: 'read', description: 'View invoices' },
    { key: 'invoices:manage', module: 'invoices', action: 'manage', description: 'Manage invoices' },
    
    // Payments
    { key: 'payments:read', module: 'payments', action: 'read', description: 'View payments' },
    { key: 'payments:manage', module: 'payments', action: 'manage', description: 'Manage payments' },
    
    // Car Wash
    { key: 'carwash:read', module: 'carwash', action: 'read', description: 'View car wash' },
    { key: 'carwash:manage', module: 'carwash', action: 'manage', description: 'Manage car wash' },
    
    // Maintenance
    { key: 'maintenance:read', module: 'maintenance', action: 'read', description: 'View maintenance' },
    { key: 'maintenance:manage', module: 'maintenance', action: 'manage', description: 'Manage maintenance' },
    
    // EV Rentals
    { key: 'evrentals:read', module: 'evrentals', action: 'read', description: 'View EV rentals' },
    { key: 'evrentals:manage', module: 'evrentals', action: 'manage', description: 'Manage EV rentals' },
    
    // Truck Rentals
    { key: 'truckrentals:read', module: 'truckrentals', action: 'read', description: 'View truck rentals' },
    { key: 'truckrentals:manage', module: 'truckrentals', action: 'manage', description: 'Manage truck rentals' },
    
    // Reports
    { key: 'reports:read', module: 'reports', action: 'read', description: 'View reports' },
    { key: 'reports:manage', module: 'reports', action: 'manage', description: 'Manage reports' },
    
    // Settings
    { key: 'settings:read', module: 'settings', action: 'read', description: 'View settings' },
    { key: 'settings:manage', module: 'settings', action: 'manage', description: 'Manage settings' },
  ];

  for (const perm of permissionDefs) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm,
    });
  }
  console.log(`✅ Created ${permissionDefs.length} permissions`);

  // Create roles
  const roles = [
    {
      name: 'SUPER_ADMIN' as const,
      displayName: 'Super Administrator',
      description: 'Full system access, can manage all modules and users',
      isSystem: true,
      permissions: permissionDefs.map(p => p.key), // All permissions
    },
    {
      name: 'ADMIN' as const,
      displayName: 'Administrator',
      description: 'Administrative access to most modules',
      isSystem: true,
      permissions: permissionDefs.map(p => p.key),
    },
    {
      name: 'MANAGER' as const,
      displayName: 'Manager',
      description: 'Manages operations, inventory, sales, rentals',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'customers:manage',
        'suppliers:manage',
        'vehicles:manage',
        'inventory:manage',
        'sales:manage',
        'purchases:manage',
        'invoices:manage',
        'payments:read',
        'carwash:manage',
        'maintenance:manage',
        'evrentals:manage',
        'truckrentals:manage',
        'reports:read',
      ],
    },
    {
      name: 'CASHIER' as const,
      displayName: 'Cashier',
      description: 'Handles sales, payments, invoices',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'customers:read',
        'customers:create',
        'inventory:read',
        'sales:create',
        'sales:read',
        'invoices:read',
        'invoices:manage',
        'payments:read',
        'payments:manage',
        'carwash:read',
        'carwash:manage',
      ],
    },
    {
      name: 'MECHANIC' as const,
      displayName: 'Mechanic',
      description: 'Handles vehicle maintenance',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'vehicles:read',
        'maintenance:read',
        'maintenance:manage',
        'inventory:read',
      ],
    },
    {
      name: 'WASHER' as const,
      displayName: 'Car Washer',
      description: 'Handles car wash operations',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'carwash:read',
        'carwash:manage',
        'customers:read',
      ],
    },
    {
      name: 'RENTAL_AGENT' as const,
      displayName: 'Rental Agent',
      description: 'Handles vehicle rentals',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'customers:read',
        'vehicles:read',
        'evrentals:read',
        'evrentals:manage',
        'truckrentals:read',
        'truckrentals:manage',
        'payments:read',
      ],
    },
    {
      name: 'ACCOUNTANT' as const,
      displayName: 'Accountant',
      description: 'Handles finances and reports',
      isSystem: false,
      permissions: [
        'dashboard:read',
        'sales:read',
        'purchases:read',
        'invoices:read',
        'payments:read',
        'reports:read',
        'reports:manage',
      ],
    },
    {
      name: 'VIEWER' as const,
      displayName: 'Viewer',
      description: 'Read-only access',
      isSystem: false,
      permissions: [
        'dashboard:read',
      ],
    },
  ];

  for (const roleDef of roles) {
    const existingRole = await prisma.role.findUnique({ where: { name: roleDef.name } });
    
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: {
        displayName: roleDef.displayName,
        description: roleDef.description,
      },
      create: {
        name: roleDef.name,
        displayName: roleDef.displayName,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
      }
    });

    // Clear existing permissions and set new ones
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    const perms = await prisma.permission.findMany({
      where: { key: { in: roleDef.permissions } }
    });

    if (perms.length > 0) {
      await prisma.rolePermission.createMany({
        data: perms.map(p => ({
          roleId: role.id,
          permissionId: p.id,
        }))
      });
    }

    console.log(`✅ Role ${role.displayName} with ${perms.length} permissions`);
  }

  // Create default super admin user
  const adminEmail = 'admin@bujaautospa.bi';
  const adminUsername = 'superadmin';
  const adminPassword = 'Admin@123456'; // Should be changed on first login

  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ email: adminEmail }, { username: adminUsername }] }
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });

    if (superAdminRole) {
      const adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          username: adminUsername,
          passwordHash: hashedPassword,
          firstName: 'Super',
          lastName: 'Admin',
          phone: '+257 79 000 000',
          status: 'ACTIVE',
          roles: {
            create: {
              roleId: superAdminRole.id,
            }
          }
        }
      });
      console.log(`✅ Created super admin user: ${adminEmail} / ${adminUsername} (password: ${adminPassword})`);
    }
  } else {
    console.log(`ℹ️ Super admin already exists: ${existingAdmin.email}`);
  }

  // Create demo manager user
  const managerEmail = 'manager@bujaautospa.bi';
  const existingManager = await prisma.user.findUnique({ where: { email: managerEmail } });
  if (!existingManager) {
    const hashedPassword = await bcrypt.hash('Manager@123', 12);
    const managerRole = await prisma.role.findUnique({ where: { name: 'MANAGER' } });
    if (managerRole) {
      await prisma.user.create({
        data: {
          email: managerEmail,
          username: 'manager',
          passwordHash: hashedPassword,
          firstName: 'Operations',
          lastName: 'Manager',
          status: 'ACTIVE',
          roles: { create: { roleId: managerRole.id } }
        }
      });
      console.log(`✅ Created manager user: ${managerEmail} (password: Manager@123)`);
    }
  }

  // Seed demo customers (Phase 2) - only when table is empty
  const existingCustomers = await prisma.customer.count({ where: { isDeleted: false } });
  if (existingCustomers === 0) {
    const customers = [
      { name: 'Ngabo Transports SARL', contactName: 'Eric Ngabo', phone: '+25779111222', email: 'contact@ngabotransports.bi', customerType: 'COMPANY', city: 'Bujumbura', address: 'Zone Bujumbura Rural, Rohero', notes: 'Fleet of 6 trucks - monthly car wash contract', creditLimit: 5000000 },
      { name: 'Hakizimana Jean', phone: '+25779222333', customerType: 'INDIVIDUAL', city: 'Gitega', notes: 'Pickup Toyota Hilux 2018', creditLimit: 0 },
      { name: 'Niyonsaba Marie', phone: '+25779333444', email: 'niyonsaba.m@gmail.bi', customerType: 'INDIVIDUAL', city: 'Bujumbura', address: 'Kibenga', creditLimit: 0 },
      { name: 'Société BUJA Logistics', contactName: 'Patrick Ndikumana', phone: '+25779444555', customerType: 'COMPANY', city: 'Bujumbura', notes: 'Truck rental + EV charging account', creditLimit: 12000000 },
      { name: 'Bigirimana Emmanuel', phone: '+25779555666', altPhone: '+25768555666', customerType: 'INDIVIDUAL', city: 'Muyinga', notes: 'Regular interior detailing', creditLimit: 0 },
      { name: 'Coopérative Kayanza Farm', contactName: 'Alice Uwase', phone: '+25779666777', email: 'kayanzafarm@coop.bi', customerType: 'COMPANY', city: 'Kayanza', notes: 'Machine wash - 4 trucks weekly', creditLimit: 2500000 },
    ];
    for (const c of customers) {
      await prisma.customer.upsert({
        where: { phone: c.phone },
        update: {},
        create: c,
      });
    }
    console.log(`✅ Seeded ${customers.length} demo customers`);
  } else {
    console.log(`ℹ️ Customers already present (${existingCustomers}), skipping`);
  }

  console.log('🎉 Seed completed successfully!');
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

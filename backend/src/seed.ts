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

  // Seed demo inventory (Truck Parts) - only when table is empty
  const existingProducts = await prisma.product.count({ where: { isDeleted: false } });
  if (existingProducts === 0) {
    const products = [
      { name: 'Brake Pads Set - Toyota Dyna', sku: 'BRK-4501', category: 'BRAKES', unit: 'SET', stockQuantity: 14, reorderLevel: 5, purchasePrice: 45000, sellingPrice: 75000, supplierName: 'Toshiba Auto Parts Dar', location: 'Shelf A1' },
      { name: 'Oil Filter - Hino 500', sku: 'ENG-2210', category: 'ENGINE', unit: 'PCS', stockQuantity: 30, reorderLevel: 10, purchasePrice: 8000, sellingPrice: 13000, supplierName: 'Toshiba Auto Parts Dar', location: 'Shelf A2' },
      { name: 'Air Filter - Toyota Dyna', sku: 'ENG-2211', category: 'ENGINE', unit: 'PCS', stockQuantity: 3, reorderLevel: 5, purchasePrice: 15000, sellingPrice: 25000, supplierName: 'Mombasa Wholesale', location: 'Shelf A2' },
      { name: 'Alternator Belt B-52', sku: 'ENG-3320', category: 'ENGINE', unit: 'PCS', stockQuantity: 22, reorderLevel: 8, purchasePrice: 12000, sellingPrice: 20000, location: 'Shelf B1' },
      { name: 'Tyre 10.00 R20 Tubeless', sku: 'TYR-1020', category: 'TYRES', unit: 'PCS', stockQuantity: 6, reorderLevel: 4, purchasePrice: 350000, sellingPrice: 500000, supplierName: 'Mombasa Wholesale', location: 'Store Yard' },
      { name: 'Engine Oil 15W-40 (20L Drum)', sku: 'FLD-9001', category: 'FLUIDS', unit: 'BOX', stockQuantity: 18, reorderLevel: 6, purchasePrice: 120000, sellingPrice: 165000, location: 'Shelf C1' },
      { name: 'Coolant Concentrate 5L', sku: 'FLD-9002', category: 'FLUIDS', unit: 'PCS', stockQuantity: 0, reorderLevel: 6, purchasePrice: 25000, sellingPrice: 40000, location: 'Shelf C1' },
      { name: 'Wiper Blades Pair 600mm', sku: 'ACC-5510', category: 'ACCESSORIES', unit: 'SET', stockQuantity: 11, reorderLevel: 4, purchasePrice: 9000, sellingPrice: 15000, location: 'Counter' },
      { name: 'Headlight Bulb H4 24V', sku: 'ELC-7702', category: 'ELECTRICAL', unit: 'PCS', stockQuantity: 2, reorderLevel: 10, purchasePrice: 3000, sellingPrice: 6000, location: 'Shelf B2' },
      { name: 'Shock Absorber Front - Dyna', sku: 'BODY-8811', category: 'BODY', unit: 'PCS', stockQuantity: 9, reorderLevel: 4, purchasePrice: 85000, sellingPrice: 130000, supplierName: 'Mombasa Wholesale', location: 'Shelf D1' },
      { name: 'Car Wash Shampoo 30L', sku: 'WAS-0001', category: 'GENERAL', unit: 'LTR', stockQuantity: 45, reorderLevel: 20, purchasePrice: 30000, sellingPrice: 3000, description: 'Bulk dispense for wash bays - selling price per litre', location: 'Wash Bay Store' },
    ];
    for (const prod of products) {
      await prisma.product.upsert({
        where: { sku: prod.sku },
        update: {},
        create: prod,
      });
    }
    console.log(`✅ Seeded ${products.length} demo products (truck parts & consumables)`);
  } else {
    console.log(`ℹ️ Products already present (${existingProducts}), skipping`);
  }

  // Seed demo sales (Phase 4) - only when table is empty
  const existingSales = await prisma.sale.count({ where: { isDeleted: false } });
  if (existingSales === 0) {
    const customers = await prisma.customer.findMany({ where: { isDeleted: false } });
    const byName = new Map(customers.map(c => [c.name, c]));
    const products = await prisma.product.findMany({ where: { isDeleted: false } });
    const bySku = new Map(products.map(pr => [pr.sku, pr]));

    const saleDefs = [
      { customer: 'Hakizimana Jean', date: '2026-09-02T09:30:00Z', payment: 'CASH', discount: 0, paid: null,
        items: [{ sku: 'ENG-2210', q: 2 }, { sku: 'ACC-5510', q: 1 }] },
      { customer: 'Ngabo Transports SARL', date: '2026-09-04T14:10:00Z', payment: 'MOBILE_MONEY', discount: 25000, paid: 300000,
        items: [{ sku: 'BRK-4501', q: 3 }, { sku: 'FLD-9001', q: 2 }] },
      { customer: 'Société BUJA Logistics', date: '2026-09-05T11:05:00Z', payment: 'CARD', discount: 0, paid: null,
        items: [{ sku: 'TYR-1020', q: 2 }, { sku: 'ENG-2211', q: 1 }] },
      { customer: 'Bigirimana Emmanuel', date: '2026-09-07T16:40:00Z', payment: 'CASH', discount: 0, paid: null,
        items: [{ sku: 'ACC-5510', q: 2 }, { sku: 'ELC-7702', q: 2 }] },
      { customer: 'Coopérative Kayanza Farm', date: '2026-09-08T10:00:00Z', payment: 'CASH', discount: 0, paid: null,
        items: [{ sku: 'ENG-3320', q: 3 }] },
      { customer: 'Niyonsaba Marie', date: '2026-09-08T15:20:00Z', payment: 'MOBILE_MONEY', discount: 0, paid: null,
        items: [{ sku: 'WAS-0001', q: 8 }] },
      // a draft: not deducted from stock, demonstrates DRAFT status
      { customer: 'Coopérative Kayanza Farm', date: '2026-09-08T17:00:00Z', payment: 'CASH', discount: 0, paid: 0, status: 'DRAFT',
        items: [{ sku: 'BODY-8811', q: 4 }] },
    ];

    let seq = 1;
    let applied = 0;
    for (const def of saleDefs) {
      const cust = byName.get(def.customer);
      if (!cust) continue;
      const lines: any[] = [];
      let subtotal = 0;
      let stockOk = true;
      for (const li of def.items) {
        const pr = bySku.get(li.sku);
        if (!pr) { stockOk = false; continue; }
        const lineTotal = pr.sellingPrice * li.q;
        subtotal += lineTotal;
        lines.push({ productId: pr.id, productName: pr.name, sku: pr.sku, quantity: li.q, unitPrice: pr.sellingPrice, lineTotal });
      }
      if (!lines.length) continue;
      if (def.status !== 'DRAFT') {
        for (const li of def.items) {
          const pr = bySku.get(li.sku);
          if (pr && pr.stockQuantity < li.q) { stockOk = false; break; }
        }
        if (!stockOk) { console.log(`ℹ️ Skipping sale ${seq}: insufficient stock for current quantities`); seq++; continue; }
      }
      const discount = Math.min(def.discount, subtotal);
      const total = subtotal - discount;
      const paid = def.paid === null ? total : Math.min(def.paid, total);
      const status = def.status || 'COMPLETED';

      await prisma.sale.create({
        data: {
          invoiceNo: `INV-2026-${String(seq).padStart(5, '0')}`,
          customerId: cust.id,
          customerName: cust.name,
          saleDate: new Date(def.date),
          status,
          paymentMethod: def.payment,
          subtotal,
          discount,
          taxRate: 0,
          taxAmount: 0,
          total,
          paidAmount: paid,
          balance: total - paid,
          items: { create: lines },
        },
      });

      if (status === 'COMPLETED') {
        for (const li of def.items) {
          const pr = bySku.get(li.sku);
          if (pr) await prisma.product.update({ where: { id: pr.id }, data: { stockQuantity: { decrement: li.q } } });
        }
      }
      applied++;
      seq++;
    }
    console.log(`✅ Seeded ${applied} demo sales (6 completed with stock decrements + 1 draft)`);
  } else {
    console.log(`ℹ️ Sales already present (${existingSales}), skipping`);
  }

  // Seed demo suppliers (Phase 5) - only when table is empty
  const existingSuppliers = await prisma.supplier.count({ where: { isDeleted: false } });
  if (existingSuppliers === 0) {
    const suppliers = [
      { name: 'Toshiba Auto Parts Dar', contactName: 'Juma Mkwawa', phone: '+255754110022', email: 'sales@toshiba-parts.co.tz', city: 'Dar es Salaam', country: undefined, taxId: 'TIN-TZ-88123', leadTimeDays: 10, notes: 'Genuine Toyota/Hino - weekly consolidations' },
      { name: 'Mombasa Wholesale', contactName: 'Amina Said', phone: '+254712330044', email: 'orders@mombasawholesale.co.ke', city: 'Mombasa', taxId: 'KRA-P051299', leadTimeDays: 7, notes: 'Tyres & filters, price-locked per quarter' },
      { name: 'Kigali Tyre & Fluids Ltd', contactName: 'Eric Habimana', phone: '+250788556677', email: 'info@kigalityre.rw', city: 'Kigali', leadTimeDays: 4, notes: 'Fast cross-border for fluids' },
      { name: 'Beijing Truck Parts Co', contactName: 'Wei Zhang', phone: '+8613500011223', email: 'export@bjtruckparts.cn', city: 'Guangzhou', taxId: 'CN-BJ-9981', leadTimeDays: 45, notes: 'Bulk shock absorbers & body kits - sea freight' },
      { name: 'Bujumbura Auto Distrib', contactName: 'Ndori Dieudonné', phone: '+257791002233', email: 'ndori@bujadistrib.bi', city: 'Bujumbura', leadTimeDays: 2, notes: 'Local stock for urgent small parts' },
    ] as any[];
    for (const sup of suppliers) {
      const { country: _c, ...clean } = sup;
      await prisma.supplier.upsert({ where: { phone: clean.phone }, update: {}, create: clean });
    }
    console.log(`✅ Seeded ${suppliers.length} demo suppliers`);
  } else {
    console.log(`ℹ️ Suppliers already present (${existingSuppliers}), skipping`);
  }

  // Seed demo vehicles (Phase 6) - only when table is empty
  const existingVehicles = await prisma.vehicle.count({ where: { isDeleted: false } });
  if (existingVehicles === 0) {
    const vehicles = [
      { plateNumber: 'BB 4521 A', type: 'TRUCK', make: 'Hino', model: '500 Series', year: 2018, color: 'White', status: 'IN_USE', odometerKm: 152340, driverName: 'Emmanuel Nkurunziza', driverPhone: '+257792200111', purchaseDate: new Date('2018-03-15'), purchasePrice: 45000000, notes: 'Long-haul Gitega-Dar. Service every 10,000 km.' },
      { plateNumber: 'BB 7810 A', type: 'TRUCK', make: 'Toyota', model: 'Dyna', year: 2020, color: 'Silver', status: 'AVAILABLE', odometerKm: 98210, purchaseDate: new Date('2020-08-02'), purchasePrice: 28000000, notes: 'Backup hauler - ready to load' },
      { plateNumber: 'AA 1204 C', type: 'TRUCK', make: 'Mitsubishi', model: 'Fuso', year: 2015, color: 'Blue', status: 'IN_MAINTENANCE', odometerKm: 210450, driverName: 'Jean Bosco', driverPhone: '+257793300222', purchaseDate: new Date('2015-01-20'), purchasePrice: 19500000, notes: 'Clutch replacement in bay 2' },
      { plateNumber: 'BB 3399 A', type: 'BUS', make: 'Hyundai', model: 'County', year: 2017, color: 'Yellow', status: 'RENTED', odometerKm: 175300, purchaseDate: new Date('2017-06-10'), purchasePrice: 32000000, notes: 'On 6-month charter to NGO fleet contract' },
      { plateNumber: 'AC 872 B', type: 'MINIBUS', make: 'Toyota', model: 'Hiace', year: 2021, color: 'White', status: 'AVAILABLE', odometerKm: 64230, purchaseDate: new Date('2021-11-05'), purchasePrice: 21000000, notes: 'Airport shuttle - 14 seats' },
      { plateNumber: 'BD 5510 A', type: 'PICKUP', make: 'Isuzu', model: 'D-Max', year: 2022, color: 'Grey', status: 'IN_USE', odometerKm: 45120, driverName: 'Aline Irakoze', driverPhone: '+257794400333', purchaseDate: new Date('2022-02-18'), purchasePrice: 24500000, notes: 'Parts delivery runs around Gitega' },
      { plateNumber: 'AB 777 A', type: 'CAR', make: 'Nissan', model: 'NP200', year: 2011, color: 'Red', status: 'RETIRED', odometerKm: 302800, purchaseDate: new Date('2011-05-30'), purchasePrice: 9000000, isActive: false, notes: 'Engine wear - sold for parts pending' },
    ] as any[];
    for (const vh of vehicles) {
      await prisma.vehicle.upsert({ where: { plateNumber: vh.plateNumber }, update: {}, create: vh });
    }
    console.log(`Seeded ${vehicles.length} demo vehicles`);
  } else {
    console.log(`Vehicles already present (${existingVehicles}), skipping`);
  }

  // Seed demo purchases (Phase 5) - only when table is empty
  const existingPurchases = await prisma.purchase.count({ where: { isDeleted: false } });
  if (existingPurchases === 0) {
    const suppliers = await prisma.supplier.findMany({ where: { isDeleted: false } });
    const supByName = new Map(suppliers.map(su => [su.name, su]));
    const products = await prisma.product.findMany({ where: { isDeleted: false } });
    const bySku = new Map(products.map(pr => [pr.sku, pr]));

    const purchaseDefs = [
      { supplier: 'Mombasa Wholesale', date: '2026-09-01T08:00:00Z', status: 'RECEIVED', payment: 'CASH', invoiceRef: 'MBS-INV-3341', discount: 0,
        items: [{ sku: 'TYR-1020', q: 6, price: 330000 }] },
      { supplier: 'Kigali Tyre & Fluids Ltd', date: '2026-09-03T10:30:00Z', status: 'RECEIVED', payment: 'MOBILE_MONEY', invoiceRef: 'KTF-771', discount: 0,
        items: [{ sku: 'FLD-9002', q: 12, price: 24000 }] },
      { supplier: 'Toshiba Auto Parts Dar', date: '2026-09-04T07:45:00Z', status: 'RECEIVED', payment: 'CREDIT_30', invoiceRef: 'TAD-2291', discount: 10000, paid: 200000,
        items: [{ sku: 'BRK-4501', q: 10, price: 42000 }, { sku: 'ENG-2210', q: 20, price: 7500 }] },
      { supplier: 'Bujumbura Auto Distrib', date: '2026-09-06T13:00:00Z', status: 'RECEIVED', payment: 'CASH', invoiceRef: null, discount: 0,
        items: [{ sku: 'ELC-7702', q: 20, price: 2800 }, { sku: 'ACC-5510', q: 8, price: 8600 }] },
      { supplier: 'Beijing Truck Parts Co', date: '2026-09-07T09:15:00Z', status: 'DRAFT', payment: 'CREDIT_30', invoiceRef: 'BJ-QT-1180', discount: 0,
        items: [{ sku: 'BODY-8811', q: 4, price: 80000 }] },
      { supplier: 'Mombasa Wholesale', date: '2026-09-08T11:20:00Z', status: 'RECEIVED', payment: 'CASH', invoiceRef: 'MBS-INV-3402', discount: 0,
        items: [{ sku: 'ENG-2211', q: 15, price: 14000 }] },
    ];

    let pseq = 1;
    let papplied = 0;
    for (const def of purchaseDefs) {
      const sup = supByName.get(def.supplier);
      if (!sup) continue;
      const lines = def.items.map(li => {
        const pr = bySku.get(li.sku);
        return {
          productId: pr?.id ?? null,
          productName: pr?.name ?? li.sku,
          sku: li.sku,
          quantity: li.q,
          unitPrice: li.price,
          lineTotal: li.q * li.price,
        };
      });
      const subtotal = lines.reduce((a: number, l: any) => a + l.lineTotal, 0);
      const discount = Math.min(def.discount || 0, subtotal);
      const total = subtotal - discount;
      const status = def.status || 'RECEIVED';
      const defaultPaid = def.payment === 'CREDIT_30' ? 0 : total;
      const paid = def.paid === undefined || def.paid === null ? defaultPaid : def.paid;

      await prisma.purchase.create({
        data: {
          poNumber: `PO-2026-${String(pseq).padStart(5, '0')}`,
          supplierId: sup.id,
          supplierName: sup.name,
          orderDate: new Date(def.date),
          status,
          paymentMethod: def.payment,
          invoiceRef: def.invoiceRef ?? null,
          subtotal, discount, taxRate: 0, taxAmount: 0, total,
          paidAmount: paid, balance: total - paid,
          items: { create: lines },
        },
      });

      if (status === 'RECEIVED') {
        for (const li of def.items) {
          const pr = bySku.get(li.sku);
          if (pr) await prisma.product.update({ where: { id: pr.id }, data: { stockQuantity: { increment: li.q }, purchasePrice: li.price } });
        }
      }
      papplied++;
      pseq++;
    }
    console.log(`✅ Seeded ${papplied} demo purchases (5 received with stock increments + 1 draft order)`);
  } else {
    console.log(`ℹ️ Purchases already present (${existingPurchases}), skipping`);
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

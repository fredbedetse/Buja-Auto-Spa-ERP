import bcrypt from 'bcryptjs';
import { priceWash } from './lib/washCatalog';
import { nextWashOrderNo } from './routes/carwash';
import { priceMaint } from './lib/maintCatalog';
import { nextMaintOrderNo } from './routes/maintenance';
import { priceBooking, overtimeFee } from './lib/rentalCatalog';
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

    // Employees
    { key: 'employees:read', module: 'employees', action: 'read', description: 'View employees' },
    { key: 'employees:manage', module: 'employees', action: 'manage', description: 'Manage employees' },
    
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
    
    // Payroll
    { key: 'payroll:read', module: 'payroll', action: 'read', description: 'View payroll runs (managers/admins only)' },
    { key: 'payroll:manage', module: 'payroll', action: 'manage', description: 'Create, adjust and settle payroll runs' },

    // Settings
    { key: 'settings:read', module: 'settings', action: 'read', description: 'View and edit personal settings' },
    { key: 'settings:manage', module: 'settings', action: 'manage', description: 'Company settings and admin designation' },

    // Expenses
    { key: 'expenses:read', module: 'expenses', action: 'read', description: 'View expense ledger' },
    { key: 'expenses:manage', module: 'expenses', action: 'manage', description: 'Record and edit expenses' },

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
        'employees:manage',
        'inventory:manage',
        'sales:manage',
        'purchases:manage',
        'invoices:manage',
        'payments:read',
        'payments:manage',
        'carwash:manage',
        'maintenance:manage',
        'evrentals:manage',
        'truckrentals:manage',
        'reports:read',
        'expenses:read',
        'payroll:read',
        'payroll:manage',
      ],
    },
    {
      name: 'CASHIER' as const,
      displayName: 'Cashier',
      description: 'Handles sales, payments, invoices',
      isSystem: false,
      permissions: [
        'expenses:read',
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
        'expenses:read',
        'expenses:manage',
        'employees:read',
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

  // Create demo cashier user (Phase 8)
  const cashierEmail = 'cashier@bujaautospa.bi';
  const existingCashier = await prisma.user.findUnique({ where: { email: cashierEmail } });
  if (!existingCashier) {
    const hashedPassword = await bcrypt.hash('Cashier@123', 12);
    const cashierRole = await prisma.role.findUnique({ where: { name: 'CASHIER' } });
    if (cashierRole) {
      await prisma.user.create({
        data: {
          email: cashierEmail,
          username: 'cashier',
          passwordHash: hashedPassword,
          firstName: 'Claudine',
          lastName: 'Niyongere',
          status: 'ACTIVE',
          roles: { create: { roleId: cashierRole.id } },
        },
      });
      console.log(`Created cashier user: ${cashierEmail} (password: Cashier@123)`);
    }
  }

  // Seed demo customers (Phase 2) - only when table is empty
  const existingCustomers = await prisma.customer.count({ where: { isDeleted: false } });
  if (existingCustomers === 0) {
    const customers = [
      { name: 'Ngabo Transports SARL', contactName: 'Eric Ngabo', phone: '+25779111222', email: 'contact@ngabotransports.bi', customerType: 'COMPANY', city: 'Bujumbura', address: 'Zone Bujumbura Rural, Rohero', notes: 'Fleet of 6 trucks - monthly car wash contract', creditLimit: 5000000 },
      { name: 'Hakizimana Jean', phone: '+25779222333', customerType: 'INDIVIDUAL', city: 'Bujumbura', notes: 'Pickup Toyota Hilux 2018', creditLimit: 0 },
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

  // Seed demo receipts (Phase 8) - only when table is empty.
  // These mirror payments already reflected in seeded sales' paidAmount,
  // so recording them as rows does not double-count the ledger.
  const existingPayments = await prisma.payment.count();
  if (existingPayments === 0) {
    const inv2 = await prisma.sale.findFirst({ where: { invoiceNo: 'INV-2026-00002' } });
    if (inv2) {
      await prisma.payment.createMany({
        data: [
          { paymentNo: 'RCPT-2026-00001', saleId: inv2.id, saleInvoiceNo: inv2.invoiceNo, customerName: inv2.customerName, amount: 200000, paymentMethod: 'MOBILE_MONEY', paymentDate: new Date('2026-09-05T09:30:00Z'), reference: 'LUMO-88213', notes: 'Lumitel mobile transfer' },
          { paymentNo: 'RCPT-2026-00002', saleId: inv2.id, saleInvoiceNo: inv2.invoiceNo, customerName: inv2.customerName, amount: 100000, paymentMethod: 'CASH', paymentDate: new Date('2026-09-07T14:05:00Z'), reference: null, notes: 'Counter cash-in' },
        ],
      });
      console.log('Seeded 2 demo receipts');
    }
  } else {
    console.log(`Receipts already present (${existingPayments}), skipping`);
  }

  // Seed demo wash orders (Phase 9) - only when table is empty
  const existingWash = await prisma.carWashOrder.count();
  if (existingWash === 0) {
    const today = new Date();
    const washRows: any[] = [
      { customerName: 'Hakizimana Jean', customerPhone: '+25779222333', vehiclePlate: '1AB-2345', vehicleType: 'SEDAN', serviceType: 'CLASSIC', status: 'COMPLETED', bay: 1, washerName: 'Jean-Claude Karerwa', paymentMethod: 'CASH', completedAt: today, notes: 'Pre-wash spray for mud' },
      { customerName: 'Claudine Niyongere', customerPhone: '+257792200333', vehiclePlate: '3CD-7788', vehicleType: 'SUV', serviceType: 'PREMIUM', status: 'COMPLETED', bay: 2, washerName: 'Fabrice Nshimirimana', paymentMethod: 'MOBILE_MONEY', completedAt: today },
      { customerName: 'Ngabo Transports SARL', customerPhone: '+257795000100', vehiclePlate: 'BB 4521 A', vehicleType: 'TRUCK', serviceType: 'FULL', status: 'IN_PROGRESS', bay: 2, washerName: 'Emmanuel Nkurunziza', startedAt: today, notes: 'Cab + trailer tarp wash' },
      { customerName: 'Niyonsaba Marie', vehiclePlate: '9XY-1001', vehicleType: 'SEDAN', serviceType: 'EXPRESS', status: 'WAITING', bay: 1 },
      { customerName: 'Bigirimana Emmanuel', vehiclePlate: '5GH-2468', vehicleType: 'SUV', serviceType: 'WAX', status: 'WAITING', bay: 3, notes: 'Wants hand-dry only' },
      { customerName: 'Societe BUJA Logistics', vehiclePlate: '7KL-1357', vehicleType: 'VAN', serviceType: 'INTERIOR', status: 'CANCELLED', bay: 1, notes: 'Customer left - no-show' },
    ];
    for (const r of washRows) {
      const { serviceType, vehicleType, status } = r as any;
      const { basePrice, surcharge, total } = priceWash(serviceType, vehicleType, 0);
      await prisma.carWashOrder.create({
        data: {
          orderNo: await nextWashOrderNo(prisma),
          customerName: r.customerName || null,
          customerPhone: r.customerPhone || null,
          vehiclePlate: r.vehiclePlate,
          vehicleType, serviceType,
          basePrice, surcharge, discount: 0, totalAmount: total,
          paidAmount: status === 'COMPLETED' ? total : 0,
          paymentMethod: r.paymentMethod || null,
          status,
          bay: r.bay || 1,
          washerName: r.washerName || null,
          notes: r.notes || null,
          startedAt: r.startedAt || (status === 'COMPLETED' ? today : null),
          completedAt: r.completedAt || null,
          lastSyncedAt: today,
        },
      });
    }
    console.log('Seeded 6 demo wash orders');
  } else {
    console.log(`Wash orders already present (${existingWash}), skipping`);
  }

  // Seed demo vehicles (Phase 6) - only when table is empty
  const existingVehicles = await prisma.vehicle.count({ where: { isDeleted: false } });
  if (existingVehicles === 0) {
    const vehicles = [
      { plateNumber: 'BB 4521 A', type: 'TRUCK', make: 'Hino', model: '500 Series', year: 2018, color: 'White', status: 'IN_USE', odometerKm: 152340, driverName: 'Emmanuel Nkurunziza', driverPhone: '+257792200111', purchaseDate: new Date('2018-03-15'), purchasePrice: 45000000, notes: 'Long-haul Bujumbura-Dar. Service every 10,000 km.' },
      { plateNumber: 'BB 7810 A', type: 'TRUCK', make: 'Toyota', model: 'Dyna', year: 2020, color: 'Silver', status: 'AVAILABLE', odometerKm: 98210, purchaseDate: new Date('2020-08-02'), purchasePrice: 28000000, notes: 'Backup hauler - ready to load' },
      { plateNumber: 'AA 1204 C', type: 'TRUCK', make: 'Mitsubishi', model: 'Fuso', year: 2015, color: 'Blue', status: 'IN_MAINTENANCE', odometerKm: 210450, driverName: 'Jean Bosco', driverPhone: '+257793300222', purchaseDate: new Date('2015-01-20'), purchasePrice: 19500000, notes: 'Clutch replacement in bay 2' },
      { plateNumber: 'BB 3399 A', type: 'BUS', make: 'Hyundai', model: 'County', year: 2017, color: 'Yellow', status: 'RENTED', odometerKm: 175300, purchaseDate: new Date('2017-06-10'), purchasePrice: 32000000, notes: 'On 6-month charter to NGO fleet contract' },
      { plateNumber: 'AC 872 B', type: 'MINIBUS', make: 'Toyota', model: 'Hiace', year: 2021, color: 'White', status: 'AVAILABLE', odometerKm: 64230, purchaseDate: new Date('2021-11-05'), purchasePrice: 21000000, notes: 'Airport shuttle - 14 seats' },
      { plateNumber: 'BD 5510 A', type: 'PICKUP', make: 'Isuzu', model: 'D-Max', year: 2022, color: 'Grey', status: 'IN_USE', odometerKm: 45120, driverName: 'Aline Irakoze', driverPhone: '+257794400333', purchaseDate: new Date('2022-02-18'), purchasePrice: 24500000, notes: 'Parts delivery runs around Bujumbura' },
      { plateNumber: 'AB 777 A', type: 'CAR', make: 'Nissan', model: 'NP200', year: 2011, color: 'Red', status: 'RETIRED', odometerKm: 302800, purchaseDate: new Date('2011-05-30'), purchasePrice: 9000000, isActive: false, notes: 'Engine wear - sold for parts pending' },
    ] as any[];
    for (const vh of vehicles) {
      await prisma.vehicle.upsert({ where: { plateNumber: vh.plateNumber }, update: {}, create: vh });
    }
    console.log(`Seeded ${vehicles.length} demo vehicles`);
  } else {
    console.log(`Vehicles already present (${existingVehicles}), skipping`);
  }

  // Seed demo maintenance work orders (Phase 10) - only when table is empty
  const existingMaint = await prisma.maintenanceOrder.count();
  if (existingMaint === 0) {
    const prodBySku = new Map((await prisma.product.findMany({ where: { isDeleted: false } })).map(p => [p.sku, p]));
    const mkLine = (sku: string, qty: number) => {
      const p = prodBySku.get(sku)!;
      return { productId: p.id, sku, name: p.name, qty, unitPrice: p.sellingPrice, lineTotal: qty * p.sellingPrice };
    };
    const DAY = 86400000;
    const nowMs = Date.now();
    const maintDefs = [
      { plate: 'BB 4521 A', svc: 'FULL', status: 'COMPLETED', prio: 'NORMAL', mech: 'Eric Bizimana', disc: 3000,
        parts: [{ sku: 'ENG-2210', q: 1 }, { sku: 'ENG-2211', q: 1 }, { sku: 'FLD-9001', q: 1 }],
        cust: 'Fleet Ops (Bujumbura-Dar)', phone: null, notes: '10,000 km interval service', findings: 'Replaced filters + full oil change. Injectors within spec.',
        startedAt: new Date(nowMs - 4 * 3600000), completedAt: new Date(nowMs - 2 * 3600000), paid: 'MOBILE_MONEY' },
      { plate: 'AA 1204 C', svc: 'BRAKES', status: 'COMPLETED', prio: 'URGENT', mech: 'Eric Bizimana', disc: 0,
        parts: [{ sku: 'BRK-4501', q: 1 }],
        cust: 'Fleet Ops', phone: null, notes: 'Clutch replacement in bay 2', findings: 'New Dyna pad set + adjusted slack.',
        startedAt: new Date(nowMs - 4 * DAY), completedAt: new Date(nowMs - 3 * DAY), paid: 'BANK_TRANSFER' },
      { plate: 'BD 5510 A', svc: 'AC', status: 'IN_PROGRESS', prio: 'URGENT', mech: 'Eric Bizimana', disc: 0,
        parts: [],
        cust: 'Aline Irakoze', phone: '+257794400333', notes: 'No cold air on airport runs', findings: null,
        startedAt: new Date(nowMs - 3600000), completedAt: null, paid: null },
      { plate: 'AC 872 B', svc: 'OIL', status: 'WAITING', prio: 'NORMAL', mech: null, disc: 0,
        parts: [{ sku: 'ENG-2210', q: 1 }],
        cust: 'Airport Shuttle Ltd', phone: '+257798800444', notes: 'Scheduled PM service', findings: null,
        scheduledFor: new Date(nowMs + DAY), startedAt: null, completedAt: null, paid: null },
      { plate: 'BB 3399 A', svc: 'DIAG', status: 'WAITING', prio: 'URGENT', mech: null, disc: 0,
        parts: [],
        cust: 'NGO Charter Desk', phone: null, notes: 'Gearbox noise reported by charterer', findings: null,
        scheduledFor: new Date(nowMs - 2 * DAY), startedAt: null, completedAt: null, paid: null },
    ] as any[];
    for (const md of maintDefs) {
      const veh = await prisma.vehicle.findFirst({ where: { plateNumber: md.plate, isDeleted: false } });
      const rows = md.parts.map((pl: any) => mkLine(pl.sku, pl.q));
      const partsTotal = rows.reduce((sum: number, r: any) => sum + r.lineTotal, 0);
      const px = priceMaint(md.svc, partsTotal, md.disc || 0);
      const consuming = md.status === 'IN_PROGRESS' || md.status === 'COMPLETED';
      if (consuming) {
        for (const r of rows) {
          await prisma.product.update({ where: { id: r.productId }, data: { stockQuantity: { decrement: r.qty }, updatedAt: new Date() } }).catch(() => undefined);
        }
      }
      await prisma.maintenanceOrder.create({
        data: {
          orderNo: await nextMaintOrderNo(prisma),
          vehicleId: veh?.id || null, vehiclePlate: md.plate, vehicleLabel: veh ? `${veh.make} ${veh.model || ''}`.trim() : null,
          customerName: md.cust, customerPhone: md.phone,
          serviceType: md.svc, priority: md.prio, status: md.status,
          mechanicName: md.mech, notes: md.notes, findings: md.findings,
          scheduledFor: md.scheduledFor || null, startedAt: md.startedAt || null, completedAt: md.completedAt || null,
          laborHours: px.laborHours, laborTotal: px.laborTotal, partsTotal, discount: px.discount, totalAmount: px.total,
          paidAmount: md.status === 'COMPLETED' ? px.total : 0,
          paymentMethod: md.paid || null,
          partsJson: JSON.stringify(rows),
          lastSyncedAt: new Date(),
        },
      });
    }
    console.log('Seeded 5 demo maintenance work orders');
  } else {
    console.log(`Maintenance work orders already present (${existingMaint}), skipping`);
  }

  // Seed demo rental fleet + bookings (Phase 11) - only when tables are empty
  const existingRentals = await prisma.rentalBooking.count();
  const existingUnits = await prisma.rentalUnit.count();
  if (existingUnits === 0) {
    const unitDefs = [
      { name: 'City Zip 200', fleetClass: 'EV', unitType: 'CITY_CAR', plate: 'EV 201 A', odometerKm: 18450 },
      { name: 'BYD ETP3 Van', fleetClass: 'EV', unitType: 'VAN_EV', plate: 'EV 310 B', odometerKm: 9120 },
      { name: 'Farizon GT 3.5t', fleetClass: 'EV', unitType: 'TRUCK_EV', plate: 'EV 777 C', odometerKm: 43900 },
      { name: 'Isuzu NQR 3T', fleetClass: 'TRUCK', unitType: 'TRUCK_3T', plate: 'TR 2211 K', odometerKm: 88210 },
      { name: 'Hino 500 8T', fleetClass: 'TRUCK', unitType: 'TRUCK_8T', plate: 'TR 1200 K', odometerKm: 156300 },
      { name: 'Fuso Fighter Head', fleetClass: 'TRUCK', unitType: 'TRAILER_HEAD', plate: 'TR 8800 K', odometerKm: 231450 },
      { name: 'Hyundai County Charter', fleetClass: 'TRUCK', unitType: 'BUS_CHARTER', plate: 'BB 3399 B', odometerKm: 175300, status: 'MAINTENANCE', notes: 'Gearbox noise - booked into the maintenance workshop' },
    ] as any[];
    const unitByPlate = new Map<string, string>();
    for (const u of unitDefs) {
      const created = await prisma.rentalUnit.create({ data: { name: u.name, fleetClass: u.fleetClass, unitType: u.unitType, plate: u.plate, odometerKm: u.odometerKm || 0, status: u.status || 'ACTIVE', notes: u.notes || null, lastSyncedAt: new Date() } });
      unitByPlate.set(u.plate, created.id);
    }
    console.log(`Seeded ${unitDefs.length} rental units`);

    const DAY = 86400000;
    const now = new Date();
    const day = (offset: number) => new Date(new Date(now.getTime() + offset * DAY).setUTCHours(0, 0, 0, 0));
    const bookingDefs = [
      { no: 'TRR-2026-00001', cls: 'TRUCK', plate: 'TR 1200 K', cust: 'Norega Mining Ltd', phone: '+257795550101', start: -9, end: -6, status: 'RETURNED', ins: false,
        returnedAt: new Date(now.getTime() - 2 * 3600000), mileageOut: 155900, mileageReturn: 156300, returnLevel: 35, damage: 'Scratched left mudguard, cabin clean', refund: true, pay: 'BANK_TRANSFER' },
      { no: 'TRR-2026-00002', cls: 'TRUCK', plate: 'TR 8800 K', cust: 'Bukavu Cargo Co', phone: '+257796660202', start: -2, end: 11, status: 'ACTIVE', ins: true,
        startedAt: new Date(now.getTime() - 2 * DAY), mileageOut: 231450, pay: 'MOBILE_MONEY' },
      { no: 'EVR-2026-00001', cls: 'EV', plate: 'EV 310 B', cust: 'SN Urwino Water Board', phone: '+257792220303', start: -1, end: 1, status: 'ACTIVE', ins: false,
        startedAt: new Date(now.getTime() - DAY), mileageOut: 9120, pay: 'CASH' },
      { no: 'EVR-2026-00002', cls: 'EV', plate: 'EV 201 A', cust: 'Guest - K. Manirakiza', phone: '+257791110404', start: 3, end: 7, status: 'PENDING', ins: true },
      { no: 'TRR-2026-00003', cls: 'TRUCK', plate: 'TR 2211 K', cust: 'Bujumbura Municipal Works', phone: null, start: 5, end: 7, status: 'PENDING', ins: false },
    ] as any[];
    for (const bd of bookingDefs) {
      const unitId = unitByPlate.get(bd.plate)!;
      const unit = await prisma.rentalUnit.findUnique({ where: { id: unitId } });
      const start = day(bd.start), end = day(bd.end);
      const px = priceBooking(unit!.unitType, start, end, bd.ins);
      const late = bd.status === 'RETURNED' ? overtimeFee(px.dailyRate, end, bd.returnedAt) : 0;
      const total = px.totalAmount + late;
      await prisma.rentalBooking.create({
        data: {
          bookingNo: bd.no, fleetClass: bd.cls, unitId, unitName: unit!.name, unitPlate: unit!.plate,
          customerName: bd.cust, customerPhone: bd.phone || null,
          startDate: start, endDate: end, status: bd.status, insurance: !!bd.ins,
          dailyRate: px.dailyRate, days: px.days, rentAmount: px.rentAmount, discount: px.discount,
          insuranceTotal: px.insuranceTotal, overtimeFee: late, totalAmount: total,
          depositAmount: px.deposit, depositRefunded: !!bd.refund,
          paidAmount: bd.status === 'PENDING' ? 0 : total,
          paymentMethod: bd.status === 'PENDING' ? null : (bd.pay || 'CASH'),
          mileageOut: bd.mileageOut ?? null, mileageReturn: bd.mileageReturn ?? null,
          returnLevel: bd.returnLevel ?? null, damageNotes: bd.damage || null,
          startedAt: bd.startedAt || (bd.status === 'RETURNED' ? new Date(start.getTime() - DAY) : null),
          returnedAt: bd.returnedAt || null,
          lastSyncedAt: new Date(),
        },
      });
    }
    console.log(`Seeded ${bookingDefs.length} rental bookings`);
  } else if (existingRentals === 0) {
    console.log('Rental units present but no bookings - run a fresh seed for demo data');
  } else {
    console.log(`Rentals already present (${existingRentals} bookings), skipping`);
  }

  // Grant settings:read to every role (everyone may personalise their app);
  // settings:manage flows automatically to ADMIN + SUPER_ADMIN via the
  // all-permissions map above, so no extra grants are needed there.
  {
    const readPerms = await prisma.permission.findMany({ where: { key: 'settings:read' } });
    if (readPerms.length) {
      const allRoles = await prisma.role.findMany({ select: { id: true } });
      for (const role of allRoles) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: readPerms[0].id } },
          create: { roleId: role.id, permissionId: readPerms[0].id },
          update: {},
        });
      }
      console.log(`Granted settings:read to ${allRoles.length} roles`);
    }
  }

  // Seed a demo PAID payroll run (Phase 16) - previous month, only when empty
  const existingRuns = await prisma.payrollRun.count();
  if (existingRuns === 0) {
    const now = new Date();
    const py = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const pm = now.getMonth() === 0 ? 12 : now.getMonth(); // previous month, 1-based
    const paidEmps = await prisma.employee.findMany({ where: { isDeleted: false, isActive: true, employmentStatus: 'ACTIVE' }, orderBy: { lastName: 'asc' } });
    if (paidEmps.length) {
      const settled = new Date(Date.UTC(py, pm - 1, 28, 10, 0, 0));
      await prisma.payrollRun.create({
        data: {
          runNo: `PR-${py}-${String(pm).padStart(2, '0')}`, year: py, month: pm, status: 'PAID',
          note: 'Seeded demo run - all staff settled by bank transfer', settledAt: settled, paymentMethod: 'BANK_TRANSFER',
          items: { create: paidEmps.map(e => ({
            employeeId: e.id, name: `${e.firstName} ${e.lastName}`, position: e.position,
            baseSalary: Math.round(e.salary), net: Math.round(e.salary), paid: true, paidAt: settled, paymentMethod: 'BANK_TRANSFER',
          })) },
        },
      });
      console.log(`Seeded payroll run PR-${py}-${String(pm).padStart(2, '0')} (${paidEmps.length} employees)`);
    }
  } else {
    console.log(`Payroll runs already present (${existingRuns}), skipping`);
  }

  // Seed demo expenses (Phase 13) - only when the table is empty
  const existingExpenses = await prisma.expense.count();
  if (existingExpenses === 0) {
    const DAY = 86400000;
    const now = new Date();
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const back = (k: number) => {
      const raw = new Date(now.getTime() - k * DAY).setUTCHours(0, 0, 0, 0);
      return new Date(Math.max(raw, firstOfMonth.getTime()));
    };
    const year = now.getUTCFullYear();
    const expenseDefs = [
      { cat: 'RENT', amt: 350000, d: back(8), vendor: 'Kigoma Road Property Ltd', pay: 'BANK_TRANSFER', who: 'Fred Bedetse', note: 'Workshop + office rent, monthly' },
      { cat: 'INSURANCE', amt: 120000, d: back(6), vendor: 'SIAR Insurance', pay: 'BANK_TRANSFER', who: 'Fred Bedetse', note: 'Fleet liability cover - premium instalment' },
      { cat: 'UTILITIES', amt: 85000, d: back(4), vendor: 'REGIDESO / SNEL', pay: 'MOBILE_MONEY', who: 'Claudine Irakoze', note: 'Water + power' },
      { cat: 'MARKETING', amt: 45000, d: back(2), vendor: 'Radio Isanganiro', pay: 'CASH', who: 'Claude Niyonkuru', note: 'Weekend spot pack for wash promos' },
      { cat: 'SUPPLIES', amt: 30000, d: back(5), vendor: 'Bujumbura Office Mart', pay: 'CASH', who: 'Claudine Irakoze', note: 'Cleaning + printer toner' },
      { cat: 'FUEL', amt: 60000, d: back(0), vendor: 'Puma Energy Bujumbura', pay: 'CASH', who: 'Eric Hakizimana', note: 'Trucks refuel before the Kiwumu haul' },
    ];
    let seq = 1;
    for (const x of expenseDefs) {
      await prisma.expense.create({
        data: {
          expenseNo: `EXP-${year}-${String(seq++).padStart(5, '0')}`,
          category: x.cat, amount: x.amt, date: x.d, vendor: x.vendor, paidBy: x.who,
          paymentMethod: x.pay, notes: x.note, lastSyncedAt: new Date(),
        },
      });
    }
    console.log(`Seeded ${expenseDefs.length} demo expenses`);
  } else {
    console.log(`Expenses already present (${existingExpenses}), skipping`);
  }

  // Seed demo employees (Phase 7) - only when table is empty
  const existingEmployees = await prisma.employee.count({ where: { isDeleted: false } });
  if (existingEmployees === 0) {
    const employees = [
      { firstName: 'Dieudonn\u00e9', lastName: 'Havyarimana', position: 'DRIVER', phone: '+257791100222', email: 'dieudonne.h@bujaautospa.bi', nationalId: '1000001-A', address: 'Kibenga, Bujumbura', city: 'Bujumbura', hireDate: new Date('2016-02-01'), salary: 450000, employmentStatus: 'ACTIVE', notes: 'Long-haul permit C+E. Primary on BB 4521 A.' },
      { firstName: 'Claudine', lastName: 'Niyongere', position: 'CASHIER', phone: '+257792200333', email: 'claudine.n@bujaautospa.bi', city: 'Bujumbura', hireDate: new Date('2019-07-15'), salary: 380000, employmentStatus: 'ACTIVE', notes: 'Front desk + car wash counter' },
      { firstName: 'Eric', lastName: 'Bizimana', position: 'MECHANIC', phone: '+257793300444', nationalId: '1000003-A', city: 'Bujumbura', hireDate: new Date('2017-03-10'), salary: 600000, employmentStatus: 'ACTIVE', notes: 'Diesel specialist, Hino/Fuso certified' },
      { firstName: 'Sylvie', lastName: 'Nikwigize', position: 'ACCOUNTANT', phone: '+257794400555', email: 'sylvie.n@bujaautospa.bi', city: 'Bujumbura', hireDate: new Date('2021-01-04'), salary: 750000, employmentStatus: 'ACTIVE', notes: 'Payroll, supplier reconciliations, OBR filings' },
      { firstName: 'Jean-Paul', lastName: 'Ndikumana', position: 'WASHER', phone: '+257795500666', city: 'Bujumbura', hireDate: new Date('2022-09-01'), salary: 220000, employmentStatus: 'ON_LEAVE', notes: 'Family leave until December' },
      { firstName: 'Aline', lastName: 'Uwimana', position: 'SALESPERSON', phone: '+257796600777', city: 'Bujumbura', hireDate: new Date('2020-05-11'), salary: 420000, employmentStatus: 'TERMINATED', isActive: false, notes: 'Moved abroad - ended on good terms' },
    ] as any[];
    for (const em of employees) {
      await prisma.employee.create({ data: em });
    }
    console.log(`Seeded ${employees.length} demo employees`);
  } else {
    console.log(`Employees already present (${existingEmployees}), skipping`);
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

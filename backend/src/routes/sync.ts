import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { nextPaymentNo } from '../routes/payments';
import { buildSaleTxn } from './sales';
import { buildPurchaseTxn } from './purchases';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Sync push schema
const syncPushSchema = z.object({
  deviceId: z.string().min(1),
  clientTimestamp: z.string().datetime().or(z.string()),
  changes: z.array(z.object({
    id: z.string().uuid().optional(), // client generated UUID
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    operation: z.enum(['CREATE', 'UPDATE', 'DELETE']),
    data: z.any().optional(),
    version: z.number().int().optional(),
    clientVersion: z.number().int().optional(),
    timestamp: z.string().datetime().or(z.string()),
  }))
});

const syncPullSchema = z.object({
  deviceId: z.string().min(1),
  lastSyncAt: z.string().datetime().or(z.string()).optional().nullable(),
  entityTypes: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(500).optional().default(100),
});

// POST /api/sync/push - Push local changes to cloud

// A soft-deleted row still holds its @unique key (phone/sku/plate). When a replayed
// CREATE collides with such a tombstone, revive it (re-keying to the client's id)
// instead of failing the queue item forever.
async function reviveTombstone(model: any, key: Record<string, any>, entityId: string, data: any) {
  const trashed = await model.findFirst({ where: { ...key, isDeleted: true } });
  if (!trashed) return null;
  return model.update({
    where: { id: trashed.id },
    data: { ...data, id: entityId, isDeleted: false, isActive: data.isActive ?? true, version: { increment: 1 }, lastSyncedAt: new Date() },
  });
}

router.post('/push', async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = syncPushSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { deviceId, changes } = parsed.data;
    const userId = req.user?.userId;

    const results: any[] = [];

    for (const change of changes) {
      try {
        const { entityType, entityId, operation, data, version, clientVersion } = change;

        // Currently only handle User entity for foundation, others will be added
        // Generic handling: log sync and handle version conflicts

        if (entityType === 'User') {
          // Handle user sync with conflict detection
          const existing = await prisma.user.findUnique({ where: { id: entityId } });

          if (operation === 'CREATE') {
            if (existing) {
              // Already exists - conflict
              results.push({
                entityType,
                entityId,
                status: 'CONFLICT',
                error: 'Entity already exists',
                serverVersion: existing.version,
                serverData: existing,
              });

              await prisma.syncLog.create({
                data: {
                  userId,
                  deviceId,
                  entityType,
                  entityId,
                  operation: 'CREATE',
                  status: 'CONFLICT',
                  version: existing.version,
                  clientVersion,
                  errorMessage: 'Entity already exists',
                  conflictData: JSON.stringify({ clientData: data, serverData: existing }),
                }
              });
              continue;
            }

            // Create new - this would be handled by specific entity routes in future
            // For now just log
            await prisma.syncLog.create({
              data: {
                userId,
                deviceId,
                entityType,
                entityId,
                operation: 'CREATE',
                status: 'SYNCED',
                version: 1,
                clientVersion,
                payload: JSON.stringify(data),
                syncedAt: new Date(),
              }
            });

            results.push({ entityType, entityId, status: 'SYNCED', version: 1 });

          } else if (operation === 'UPDATE') {
            if (!existing) {
              results.push({
                entityType,
                entityId,
                status: 'FAILED',
                error: 'Entity not found',
              });
              await prisma.syncLog.create({
                data: {
                  userId,
                  deviceId,
                  entityType,
                  entityId,
                  operation: 'UPDATE',
                  status: 'FAILED',
                  version: 0,
                  clientVersion,
                  errorMessage: 'Entity not found',
                  payload: JSON.stringify(data),
                }
              });
              continue;
            }

            // Conflict detection: if clientVersion != server version
            if (clientVersion !== undefined && clientVersion !== existing.version) {
              results.push({
                entityType,
                entityId,
                status: 'CONFLICT',
                error: 'Version conflict',
                serverVersion: existing.version,
                clientVersion,
                serverData: existing,
              });

              await prisma.syncLog.create({
                data: {
                  userId,
                  deviceId,
                  entityType,
                  entityId,
                  operation: 'UPDATE',
                  status: 'CONFLICT',
                  version: existing.version,
                  clientVersion,
                  serverVersion: existing.version,
                  errorMessage: 'Version conflict',
                  conflictData: JSON.stringify({ clientData: data, serverData: existing }),
                }
              });
              continue;
            }

            // No conflict, proceed (for foundation, we just log - actual update would be entity-specific)
            // In future phases, this will apply updates to respective tables

            await prisma.syncLog.create({
              data: {
                userId,
                deviceId,
                entityType,
                entityId,
                operation: 'UPDATE',
                status: 'SYNCED',
                version: existing.version + 1,
                clientVersion,
                serverVersion: existing.version,
                payload: JSON.stringify(data),
                syncedAt: new Date(),
              }
            });

            results.push({ entityType, entityId, status: 'SYNCED', version: existing.version + 1 });

          } else if (operation === 'DELETE') {
            if (!existing) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }

            await prisma.syncLog.create({
              data: {
                userId,
                deviceId,
                entityType,
                entityId,
                operation: 'DELETE',
                status: 'SYNCED',
                version: existing.version + 1,
                clientVersion,
                syncedAt: new Date(),
              }
            });

            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Customer') {
          // Customer module: real data application with optimistic locking
          const existing = await prisma.customer.findUnique({ where: { id: entityId } });

          if (operation === 'CREATE') {
            if (existing && !existing.isDeleted) {
              results.push({
                entityType,
                entityId,
                status: 'CONFLICT',
                error: 'Entity already exists',
                serverVersion: existing.version,
                serverData: existing,
              });

              await prisma.syncLog.create({
                data: {
                  userId,
                  deviceId,
                  entityType,
                  entityId,
                  operation: 'CREATE',
                  status: 'CONFLICT',
                  version: existing.version,
                  clientVersion,
                  errorMessage: 'Entity already exists',
                  conflictData: JSON.stringify({ clientData: data, serverData: existing }),
                }
              });
              continue;
            }

            const { deviceId: _dd, id: _id, ...cdata } = data || {};

            if (existing && existing.isDeleted) {
              // Replay of a previously deleted record - revive with client data
              await prisma.customer.update({
                where: { id: entityId },
                data: {
                  ...cdata,
                  isDeleted: false,
                  version: { increment: 1 },
                  lastSyncedAt: new Date(),
                  deviceId,
                }
              });
            } else {
              const _map: any = {
                  name: cdata.name,
                  contactName: cdata.contactName ?? null,
                  phone: cdata.phone,
                  altPhone: cdata.altPhone ?? null,
                  email: cdata.email ?? null,
                  customerType: cdata.customerType ?? 'INDIVIDUAL',
                  address: cdata.address ?? null,
                  city: cdata.city ?? null,
                  notes: cdata.notes ?? null,
                  creditLimit: cdata.creditLimit ?? 0,
                  isActive: cdata.isActive ?? true,
                  lastSyncedAt: new Date(),
                  deviceId,
                };
              const _tr = await prisma.customer.findFirst({ where: { phone: _map.phone, isDeleted: true } });
              if (_tr) {
                await prisma.customer.update({ where: { id: _tr.id }, data: { ..._map, id: entityId, isDeleted: false, version: { increment: 1 } } });
              } else {
                await prisma.customer.create({ data: { id: entityId, ..._map } });
              }
            }

            await prisma.syncLog.create({
              data: {
                userId,
                deviceId,
                entityType,
                entityId,
                operation: 'CREATE',
                status: 'SYNCED',
                version: 1,
                clientVersion,
                payload: JSON.stringify(data),
                syncedAt: new Date(),
              }
            });

            results.push({ entityType, entityId, status: 'SYNCED', version: 1 });

          } else if (operation === 'UPDATE') {
            if (!existing) {
              results.push({
                entityType,
                entityId,
                status: 'FAILED',
                error: 'Entity not found',
              });
              await prisma.syncLog.create({
                data: {
                  userId,
                  deviceId,
                  entityType,
                  entityId,
                  operation: 'UPDATE',
                  status: 'FAILED',
                  version: 0,
                  clientVersion,
                  errorMessage: 'Entity not found',
                  payload: JSON.stringify(data),
                }
              });
              continue;
            }

            // Conflict detection: if clientVersion != server version
            if (clientVersion !== undefined && clientVersion !== existing.version) {
              results.push({
                entityType,
                entityId,
                status: 'CONFLICT',
                error: 'Version conflict',
                serverVersion: existing.version,
                clientVersion,
                serverData: existing,
              });

              await prisma.syncLog.create({
                data: {
                  userId,
                  deviceId,
                  entityType,
                  entityId,
                  operation: 'UPDATE',
                  status: 'CONFLICT',
                  version: existing.version,
                  clientVersion,
                  serverVersion: existing.version,
                  errorMessage: 'Version conflict',
                  conflictData: JSON.stringify({ clientData: data, serverData: existing }),
                }
              });
              continue;
            }

            // No conflict - apply the update to the customer table
            const { deviceId: _dd, id: _id, version: _v, ...cupdate } = data || {};
            const updated = await prisma.customer.update({
              where: { id: entityId },
              data: {
                ...cupdate,
                isDeleted: false,
                version: { increment: 1 },
                lastSyncedAt: new Date(),
                deviceId,
              }
            });

            await prisma.syncLog.create({
              data: {
                userId,
                deviceId,
                entityType,
                entityId,
                operation: 'UPDATE',
                status: 'SYNCED',
                version: updated.version,
                clientVersion,
                serverVersion: existing.version,
                payload: JSON.stringify(data),
                syncedAt: new Date(),
              }
            });

            results.push({ entityType, entityId, status: 'SYNCED', version: updated.version });

          } else if (operation === 'DELETE') {
            if (!existing || existing.isDeleted) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }

            await prisma.customer.update({
              where: { id: entityId },
              data: { isDeleted: true, isActive: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId }
            });

            await prisma.syncLog.create({
              data: {
                userId,
                deviceId,
                entityType,
                entityId,
                operation: 'DELETE',
                status: 'SYNCED',
                version: (existing.version || 1) + 1,
                clientVersion,
                syncedAt: new Date(),
              }
            });

            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Supplier') {
          const existing = await prisma.supplier.findUnique({ where: { id: entityId } });

          if (operation === 'CREATE') {
            if (existing && !existing.isDeleted) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Entity already exists', serverVersion: existing.version, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'CONFLICT', version: existing.version, clientVersion, errorMessage: 'Entity already exists', conflictData: JSON.stringify({ clientData: data, serverData: existing }) } });
              continue;
            }
            const { deviceId: _dd, id: _id, version: _v, ...sdata } = data || {};
            try {
              if (existing && existing.isDeleted) {
                await prisma.supplier.update({ where: { id: entityId }, data: { ...sdata, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              } else {
                await prisma.supplier.create({ data: { id: entityId, ...sdata, lastSyncedAt: new Date(), deviceId } });
              }
            } catch (supErr: any) {
                            if (supErr.code === 'P2002') {
                const rev = await reviveTombstone(prisma.supplier, { phone: sdata.phone }, entityId, { ...sdata, deviceId });
                if (rev) {
                  await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: rev.version, clientVersion, payload: JSON.stringify(data), syncedAt: new Date() } });
                  results.push({ entityType, entityId, status: 'SYNCED', version: rev.version });
                  continue;
                }
              }
const reason = supErr.code === 'P2002' ? 'Duplicate phone - another supplier already uses it' : (supErr.message || 'Supplier could not be applied');
              results.push({ entityType, entityId, status: 'FAILED', error: reason });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'FAILED', version: 0, clientVersion, errorMessage: reason, payload: JSON.stringify(data) } });
              continue;
            }
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: 1, clientVersion, payload: JSON.stringify(data), syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED', version: 1 });

          } else if (operation === 'UPDATE') {
            if (!existing) {
              results.push({ entityType, entityId, status: 'FAILED', error: 'Entity not found' });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'FAILED', version: 0, clientVersion, errorMessage: 'Entity not found', payload: JSON.stringify(data) } });
            } else if (clientVersion !== undefined && clientVersion !== existing.version) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Version conflict', serverVersion: existing.version, clientVersion, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'CONFLICT', version: existing.version, clientVersion, serverVersion: existing.version, errorMessage: 'Version conflict', conflictData: JSON.stringify({ clientData: data, serverData: existing }) } });
            } else {
              const { deviceId: _dd2, id: _id2, version: _v2, ...supdate } = data || {};
              const updated = await prisma.supplier.update({ where: { id: entityId }, data: { ...supdate, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'SYNCED', version: updated.version, clientVersion, serverVersion: existing.version, payload: JSON.stringify(data), syncedAt: new Date() } });
              results.push({ entityType, entityId, status: 'SYNCED', version: updated.version });
            }

          } else if (operation === 'DELETE') {
            if (!existing || existing.isDeleted) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }
            await prisma.supplier.update({ where: { id: entityId }, data: { isDeleted: true, isActive: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'SYNCED', version: (existing.version || 1) + 1, clientVersion, syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Product') {
          // Inventory module: apply real data with optimistic locking
          const existing = await prisma.product.findUnique({ where: { id: entityId } });

          if (operation === 'CREATE') {
            if (existing && !existing.isDeleted) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Entity already exists', serverVersion: existing.version, serverData: existing });
              await prisma.syncLog.create({
                data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'CONFLICT', version: existing.version, clientVersion, errorMessage: 'Entity already exists', conflictData: JSON.stringify({ clientData: data, serverData: existing }) }
              });
              continue;
            }

            const { deviceId: _dd, id: _id, ...pdata } = data || {};

            if (existing && existing.isDeleted) {
              await prisma.product.update({ where: { id: entityId }, data: { ...pdata, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            } else {
              const _map: any = {
                  name: pdata.name,
                  sku: pdata.sku || `OFS-${Date.now()}`,
                  category: pdata.category ?? 'GENERAL',
                  unit: pdata.unit ?? 'PCS',
                  stockQuantity: pdata.stockQuantity ?? 0,
                  reorderLevel: pdata.reorderLevel ?? 5,
                  purchasePrice: pdata.purchasePrice ?? 0,
                  sellingPrice: pdata.sellingPrice ?? 0,
                  supplierName: pdata.supplierName ?? null,
                  location: pdata.location ?? null,
                  description: pdata.description ?? null,
                  isActive: pdata.isActive ?? true,
                  lastSyncedAt: new Date(),
                  deviceId,
                };
              const _tr = await prisma.product.findFirst({ where: { sku: _map.sku, isDeleted: true } });
              if (_tr) {
                await prisma.product.update({ where: { id: _tr.id }, data: { ..._map, id: entityId, isDeleted: false, version: { increment: 1 } } });
              } else {
                await prisma.product.create({ data: { id: entityId, ..._map } });
              }
            }

            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: 1, clientVersion, payload: JSON.stringify(data), syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED', version: 1 });

          } else if (operation === 'UPDATE') {
            if (!existing) {
              results.push({ entityType, entityId, status: 'FAILED', error: 'Entity not found' });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'FAILED', version: 0, clientVersion, errorMessage: 'Entity not found', payload: JSON.stringify(data) } });
              continue;
            }

            if (clientVersion !== undefined && clientVersion !== existing.version) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Version conflict', serverVersion: existing.version, clientVersion, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'CONFLICT', version: existing.version, clientVersion, serverVersion: existing.version, errorMessage: 'Version conflict', conflictData: JSON.stringify({ clientData: data, serverData: existing }) } });
              continue;
            }

            const { deviceId: _dd2, id: _id2, version: _v2, ...pupdate } = data || {};
            const updated = await prisma.product.update({ where: { id: entityId }, data: { ...pupdate, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'SYNCED', version: updated.version, clientVersion, serverVersion: existing.version, payload: JSON.stringify(data), syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED', version: updated.version });

          } else if (operation === 'DELETE') {
            if (!existing || existing.isDeleted) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }
            await prisma.product.update({ where: { id: entityId }, data: { isDeleted: true, isActive: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'SYNCED', version: (existing.version || 1) + 1, clientVersion, syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Sale') {
          const existing = await prisma.sale.findFirst({ where: { id: entityId }, include: { items: true } });

          if (operation === 'CREATE') {
            if (existing && !existing.isDeleted) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Entity already exists', serverVersion: existing.version, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'CONFLICT', version: existing.version, clientVersion, errorMessage: 'Sale already exists', conflictData: JSON.stringify({ serverData: existing }) } });
              continue;
            }
            try {
              const { deviceId: _dd, id: _sid, invoiceNo, ...saleInput } = data || {};
              const sale = await prisma.$transaction(async (tx) => buildSaleTxn(tx, {
                id: entityId,
                invoiceNo,
                deviceId,
                customerId: saleInput.customerId,
                saleDate: saleInput.saleDate,
                status: saleInput.status || 'COMPLETED',
                paymentMethod: saleInput.paymentMethod || 'CASH',
                discount: saleInput.discount || 0,
                taxRate: saleInput.taxRate || 0,
                paidAmount: saleInput.paidAmount,
                notes: saleInput.notes,
                items: (saleInput.items || []).map((i: any) => ({
                  productId: i.productId || null,
                  productName: i.productName || 'Item',
                  sku: i.sku || null,
                  quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
                  unitPrice: Number(i.unitPrice) || 0,
                })),
              }, { checkStock: true }));

              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: 1, clientVersion, payload: JSON.stringify({ invoiceNo: sale.invoiceNo, total: sale.total }), syncedAt: new Date() } });
              results.push({ entityType, entityId, status: 'SYNCED', version: 1, invoiceNo: sale.invoiceNo });
            } catch (saleErr: any) {
              const reason = saleErr.code === 'INSUFFICIENT_STOCK' ? saleErr.message : (saleErr.message || 'Sale could not be applied');
              results.push({ entityType, entityId, status: 'FAILED', error: reason });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'FAILED', version: 0, clientVersion, errorMessage: reason, payload: JSON.stringify(data) } });
            }

          } else if (operation === 'UPDATE') {
            results.push({ entityType, entityId, status: 'FAILED', error: 'Sales are immutable; cancel and re-create instead of editing' });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'FAILED', version: existing?.version || 0, clientVersion, errorMessage: 'Sales are immutable', payload: JSON.stringify(data) } });

          } else if (operation === 'DELETE') {
            if (!existing || existing.isDeleted) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }
            await prisma.$transaction(async (tx) => {
              if (existing.status === 'COMPLETED') {
                for (const it of existing.items) {
                  if (it.productId) {
                    await tx.product.update({ where: { id: it.productId }, data: { stockQuantity: { increment: it.quantity }, version: { increment: 1 }, lastSyncedAt: new Date() } });
                  }
                }
              }
              await tx.sale.update({ where: { id: existing.id }, data: { isDeleted: true, status: 'CANCELLED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'SYNCED', version: (existing.version || 1) + 1, clientVersion, syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Vehicle') {
          const existing = await prisma.vehicle.findUnique({ where: { id: entityId } });

          if (operation === 'CREATE') {
            if (existing && !existing.isDeleted) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Entity already exists', serverVersion: existing.version, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'CONFLICT', version: existing.version, clientVersion, errorMessage: 'Entity already exists', conflictData: JSON.stringify({ clientData: data, serverData: existing }) } });
              continue;
            }
            const { deviceId: _vd, id: _vid, version: _vv, ...vdata } = data || {};
            try {
              if (existing && existing.isDeleted) {
                await prisma.vehicle.update({ where: { id: entityId }, data: { ...vdata, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              } else {
                await prisma.vehicle.create({ data: { id: entityId, ...vdata, lastSyncedAt: new Date(), deviceId } });
              }
            } catch (vehErr: any) {
                            if (vehErr.code === 'P2002') {
                const rev = await reviveTombstone(prisma.vehicle, { plateNumber: vdata.plateNumber }, entityId, { ...vdata, deviceId });
                if (rev) {
                  await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: rev.version, clientVersion, payload: JSON.stringify(data), syncedAt: new Date() } });
                  results.push({ entityType, entityId, status: 'SYNCED', version: rev.version });
                  continue;
                }
              }
const reason = vehErr.code === 'P2002' ? 'Duplicate plate - another vehicle already uses it' : (vehErr.message || 'Vehicle could not be applied');
              results.push({ entityType, entityId, status: 'FAILED', error: reason });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'FAILED', version: 0, clientVersion, errorMessage: reason, payload: JSON.stringify(data) } });
              continue;
            }
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: 1, clientVersion, payload: JSON.stringify(data), syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED', version: 1 });

          } else if (operation === 'UPDATE') {
            if (!existing) {
              results.push({ entityType, entityId, status: 'FAILED', error: 'Entity not found' });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'FAILED', version: 0, clientVersion, errorMessage: 'Entity not found', payload: JSON.stringify(data) } });
            } else if (clientVersion !== undefined && clientVersion !== existing.version) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Version conflict', serverVersion: existing.version, clientVersion, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'CONFLICT', version: existing.version, clientVersion, serverVersion: existing.version, errorMessage: 'Version conflict', conflictData: JSON.stringify({ clientData: data, serverData: existing }) } });
            } else {
              const { deviceId: _vd2, id: _vid2, version: _vv2, ...vupdate } = data || {};
              const upd: any = { ...vupdate };
              // Odometers never roll back, even via replayed offline edits
              if (upd.odometerKm !== undefined && upd.odometerKm < existing.odometerKm) upd.odometerKm = existing.odometerKm;
              const updated = await prisma.vehicle.update({ where: { id: entityId }, data: { ...upd, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'SYNCED', version: updated.version, clientVersion, serverVersion: existing.version, payload: JSON.stringify(data), syncedAt: new Date() } });
              results.push({ entityType, entityId, status: 'SYNCED', version: updated.version });
            }

          } else if (operation === 'DELETE') {
            if (!existing || existing.isDeleted) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }
            await prisma.vehicle.update({ where: { id: entityId }, data: { isDeleted: true, isActive: false, status: 'RETIRED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'SYNCED', version: (existing.version || 1) + 1, clientVersion, syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Payment') {
          const existing = await prisma.payment.findUnique({ where: { id: entityId } });

          if (operation === 'CREATE') {
            if (existing) {
              results.push({ entityType, entityId, status: 'SYNCED', version: existing.version, paymentNo: existing.paymentNo });
              continue;
            }
            const { deviceId: _pd, id: _pid, paymentNo: _pno, saleId, paymentDate, amount, ...pRest } = data || {};
            const sale = await prisma.sale.findFirst({ where: { id: saleId, isDeleted: false } });
            if (!sale) {
              results.push({ entityType, entityId, status: 'FAILED', error: 'Invoice not found on server' });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'FAILED', version: 0, clientVersion, errorMessage: 'Invoice not found', payload: JSON.stringify(data) } });
              continue;
            }
            const bal = Math.max(0, sale.balance ?? 0);
            if (!(amount > 0) || amount > bal + 0.001) {
              const reason = amount > bal + 0.001 ? `Exceeds balance (${bal})` : 'Invalid amount';
              results.push({ entityType, entityId, status: 'FAILED', error: reason });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'FAILED', version: 0, clientVersion, errorMessage: reason, payload: JSON.stringify(data) } });
              continue;
            }
            const pno = await nextPaymentNo();
            const created = await prisma.$transaction(async (tx) => {
              const p = await tx.payment.create({
                data: {
                  id: entityId, paymentNo: pno, saleId: sale.id, saleInvoiceNo: sale.invoiceNo, customerName: sale.customerName,
                  amount, paymentMethod: pRest.paymentMethod || 'CASH',
                  paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
                  reference: pRest.reference || null, notes: pRest.notes || null,
                  lastSyncedAt: new Date(), deviceId,
                },
              });
              const paid = (sale.paidAmount || 0) + p.amount;
              const updatedSale = await tx.sale.update({ where: { id: sale.id }, data: { paidAmount: paid, balance: Math.max(0, sale.total - paid), version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              await tx.syncLog.create({ data: { userId, deviceId, entityType: 'Sale', entityId: sale.id, operation: 'UPDATE', status: 'SYNCED', version: updatedSale.version, syncedAt: new Date() } });
              return p;
            });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: 1, clientVersion, payload: JSON.stringify(data), syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED', version: 1, paymentNo: created.paymentNo });

          } else if (operation === 'UPDATE') {
            results.push({ entityType, entityId, status: 'FAILED', error: 'Receipts are immutable; void and re-record instead of editing' });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'FAILED', version: existing?.version || 0, clientVersion, errorMessage: 'Receipts are immutable', payload: JSON.stringify(data) } });

          } else if (operation === 'DELETE') {
            if (!existing) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already removed' });
              continue;
            }
            if (existing.status === 'COMPLETED') {
              const sale = await prisma.sale.findUnique({ where: { id: existing.saleId } });
              if (sale && !sale.isDeleted) {
                const paid = Math.max(0, (sale.paidAmount || 0) - existing.amount);
                await prisma.sale.update({ where: { id: sale.id }, data: { paidAmount: paid, balance: Math.max(0, sale.total - paid), version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              }
            }
            await prisma.payment.update({ where: { id: entityId }, data: { status: 'VOID', voidReason: 'Voided offline', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'SYNCED', version: (existing.version || 1) + 1, clientVersion, syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Employee') {
          const existing = await prisma.employee.findUnique({ where: { id: entityId } });

          if (operation === 'CREATE') {
            if (existing && !existing.isDeleted) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Entity already exists', serverVersion: existing.version, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'CONFLICT', version: existing.version, clientVersion, errorMessage: 'Entity already exists', conflictData: JSON.stringify({ clientData: data, serverData: existing }) } });
              continue;
            }
            const { deviceId: _ed, id: _eid, version: _ev, ...edata } = data || {};
            if (edata.hireDate) edata.hireDate = new Date(edata.hireDate);
            try {
              if (existing && existing.isDeleted) {
                await prisma.employee.update({ where: { id: entityId }, data: { ...edata, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              } else {
                await prisma.employee.create({ data: { id: entityId, ...edata, lastSyncedAt: new Date(), deviceId } });
              }
            } catch (empErr: any) {
              const reason = empErr.message || 'Employee could not be applied';
              results.push({ entityType, entityId, status: 'FAILED', error: reason });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'FAILED', version: 0, clientVersion, errorMessage: reason, payload: JSON.stringify(data) } });
              continue;
            }
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: 1, clientVersion, payload: JSON.stringify(data), syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED', version: 1 });

          } else if (operation === 'UPDATE') {
            if (!existing) {
              results.push({ entityType, entityId, status: 'FAILED', error: 'Entity not found' });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'FAILED', version: 0, clientVersion, errorMessage: 'Entity not found', payload: JSON.stringify(data) } });
            } else if (clientVersion !== undefined && clientVersion !== existing.version) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Version conflict', serverVersion: existing.version, clientVersion, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'CONFLICT', version: existing.version, clientVersion, serverVersion: existing.version, errorMessage: 'Version conflict', conflictData: JSON.stringify({ clientData: data, serverData: existing }) } });
            } else {
              const { deviceId: _ed2, id: _eid2, version: _ev2, ...eupdate } = data || {};
              const upd: any = { ...eupdate };
              if (upd.hireDate) upd.hireDate = new Date(upd.hireDate);
              const updated = await prisma.employee.update({ where: { id: entityId }, data: { ...upd, isDeleted: false, version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'SYNCED', version: updated.version, clientVersion, serverVersion: existing.version, payload: JSON.stringify(data), syncedAt: new Date() } });
              results.push({ entityType, entityId, status: 'SYNCED', version: updated.version });
            }

          } else if (operation === 'DELETE') {
            if (!existing || existing.isDeleted) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }
            await prisma.employee.update({ where: { id: entityId }, data: { isDeleted: true, isActive: false, employmentStatus: 'TERMINATED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'SYNCED', version: (existing.version || 1) + 1, clientVersion, syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else if (entityType === 'Purchase') {
          const existing = await prisma.purchase.findFirst({ where: { id: entityId }, include: { items: true } });

          if (operation === 'CREATE') {
            if (existing && !existing.isDeleted) {
              results.push({ entityType, entityId, status: 'CONFLICT', error: 'Entity already exists', serverVersion: existing.version, serverData: existing });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'CONFLICT', version: existing.version, clientVersion, errorMessage: 'Purchase already exists', conflictData: JSON.stringify({ serverData: existing }) } });
              continue;
            }
            try {
              const { deviceId: _dd, id: _pid, poNumber, ...pInput } = data || {};
              const purchase = await prisma.$transaction(async (tx) => buildPurchaseTxn(tx, {
                id: entityId,
                poNumber,
                deviceId,
                supplierId: pInput.supplierId,
                orderDate: pInput.orderDate,
                expectedDate: pInput.expectedDate,
                status: pInput.status || 'RECEIVED',
                paymentMethod: pInput.paymentMethod || 'CASH',
                invoiceRef: pInput.invoiceRef,
                discount: pInput.discount || 0,
                taxRate: pInput.taxRate || 0,
                paidAmount: pInput.paidAmount,
                notes: pInput.notes,
                items: (pInput.items || []).map((i: any) => ({
                  productId: i.productId || null,
                  productName: i.productName || 'Item',
                  sku: i.sku || null,
                  quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
                  unitPrice: Number(i.unitPrice) || 0,
                })),
              }));

              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'SYNCED', version: 1, clientVersion, payload: JSON.stringify({ poNumber: purchase.poNumber, total: purchase.total }), syncedAt: new Date() } });
              results.push({ entityType, entityId, status: 'SYNCED', version: 1, poNumber: purchase.poNumber });
            } catch (pErr: any) {
              const reason = pErr.code === 'SUPPLIER_NOT_FOUND' ? 'Supplier not found on server yet - sync the supplier first' : (pErr.message || 'Purchase could not be applied');
              results.push({ entityType, entityId, status: 'FAILED', error: reason });
              await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'CREATE', status: 'FAILED', version: 0, clientVersion, errorMessage: reason, payload: JSON.stringify(data) } });
            }

          } else if (operation === 'UPDATE') {
            results.push({ entityType, entityId, status: 'FAILED', error: 'Purchases are immutable; cancel and re-create instead of editing' });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'UPDATE', status: 'FAILED', version: existing?.version || 0, clientVersion, errorMessage: 'Purchases are immutable', payload: JSON.stringify(data) } });

          } else if (operation === 'DELETE') {
            if (!existing || existing.isDeleted) {
              results.push({ entityType, entityId, status: 'SYNCED', message: 'Already deleted' });
              continue;
            }
            // Reverse stock for RECEIVED purchases, guarded so stock never goes negative
            if (existing.status === 'RECEIVED') {
              const blocker = await (async () => {
                for (const it of existing.items) {
                  if (!it.productId) continue;
                  const p = await prisma.product.findUnique({ where: { id: it.productId } });
                  if (p && p.stockQuantity < it.quantity) {
                    return `Cannot reverse: only ${p.stockQuantity} in stock for "${p.name}" (${it.quantity} received, some already consumed)`;
                  }
                }
                return null;
              })();
              if (blocker) {
                results.push({ entityType, entityId, status: 'FAILED', error: blocker });
                await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'FAILED', version: existing.version, clientVersion, errorMessage: blocker, payload: JSON.stringify(data) } });
                continue;
              }
            }
            await prisma.$transaction(async (tx) => {
              if (existing.status === 'RECEIVED') {
                for (const it of existing.items) {
                  if (it.productId) {
                    await tx.product.update({ where: { id: it.productId }, data: { stockQuantity: { decrement: it.quantity }, version: { increment: 1 }, lastSyncedAt: new Date() } });
                  }
                }
              }
              await tx.purchase.update({ where: { id: existing.id }, data: { isDeleted: true, status: 'CANCELLED', version: { increment: 1 }, lastSyncedAt: new Date(), deviceId } });
            });
            await prisma.syncLog.create({ data: { userId, deviceId, entityType, entityId, operation: 'DELETE', status: 'SYNCED', version: (existing.version || 1) + 1, clientVersion, syncedAt: new Date() } });
            results.push({ entityType, entityId, status: 'SYNCED' });
          }

        } else {
          // For other entity types (future modules), generic handling
          // Log as synced for now - actual entity handling will be implemented per module
          await prisma.syncLog.create({
            data: {
              userId,
              deviceId,
              entityType,
              entityId,
              operation: operation as any,
              status: 'SYNCED',
              version: version || 1,
              clientVersion,
              payload: data ? JSON.stringify(data) : null,
              syncedAt: new Date(),
            }
          });

          results.push({ entityType, entityId, status: 'SYNCED', version: version || 1 });
        }

      } catch (itemError: any) {
        console.error(`Sync push error for ${change.entityId}:`, itemError);
        results.push({
          entityType: change.entityType,
          entityId: change.entityId,
          status: 'FAILED',
          error: itemError.message,
        });

        await prisma.syncLog.create({
          data: {
            userId,
            deviceId,
            entityType: change.entityType,
            entityId: change.entityId,
            operation: change.operation as any,
            status: 'FAILED',
            version: change.version || 0,
            clientVersion: change.clientVersion,
            errorMessage: itemError.message,
            payload: change.data ? JSON.stringify(change.data) : null,
          }
        });
      }
    }

    // Update sync metadata
    await prisma.syncMetadata.upsert({
      where: { deviceId },
      create: {
        deviceId,
        userId,
        lastPushAt: new Date(),
        lastSyncAt: new Date(),
      },
      update: {
        lastPushAt: new Date(),
        lastSyncAt: new Date(),
        userId,
      }
    });

    res.json({
      success: true,
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Sync push error:', error);
    res.status(500).json({ error: 'Sync push failed' });
  }
});

// POST /api/sync/pull - Pull changes from cloud
router.post('/pull', async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = syncPullSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { deviceId, lastSyncAt, entityTypes, limit } = parsed.data;
    const userId = req.user?.userId;

    const lastSyncDate = lastSyncAt ? new Date(lastSyncAt as string) : new Date(0);

    // For foundation, we pull Users that changed since lastSync
    // In future, this will include all business entities

    let changes: any[] = [];

    if (!entityTypes || entityTypes.includes('User')) {
      const users = await prisma.user.findMany({
        where: {
          updatedAt: { gt: lastSyncDate },
          isDeleted: false,
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
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
          roles: {
            include: { role: true }
          }
        }
      });

      changes.push(...users.map(u => ({
        entityType: 'User',
        entityId: u.id,
        operation: 'UPDATE',
        data: {
          ...u,
          roles: u.roles.map(ur => ur.role.name),
        },
        version: u.version,
        timestamp: u.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Product')) {
      const products = await prisma.product.findMany({
        where: {
          updatedAt: { gt: lastSyncDate },
          isDeleted: false,
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });

      changes.push(...products.map(pr => ({
        entityType: 'Product',
        entityId: pr.id,
        operation: 'UPDATE',
        data: pr,
        version: pr.version,
        timestamp: pr.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Customer')) {
      const customers = await prisma.customer.findMany({
        where: {
          updatedAt: { gt: lastSyncDate },
          isDeleted: false,
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });

      changes.push(...customers.map(c => ({
        entityType: 'Customer',
        entityId: c.id,
        operation: 'UPDATE',
        data: c,
        version: c.version,
        timestamp: c.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Sale')) {
      const sales = await prisma.sale.findMany({
        where: { updatedAt: { gt: lastSyncDate }, isDeleted: false },
        take: limit,
        orderBy: { updatedAt: 'asc' },
        include: { items: true },
      });

      changes.push(...sales.map(sl => ({
        entityType: 'Sale',
        entityId: sl.id,
        operation: 'UPDATE',
        data: sl,
        version: sl.version,
        timestamp: sl.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Supplier')) {
      const suppliers = await prisma.supplier.findMany({
        where: { updatedAt: { gt: lastSyncDate }, isDeleted: false },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });
      changes.push(...suppliers.map(su => ({
        entityType: 'Supplier',
        entityId: su.id,
        operation: 'UPDATE',
        data: su,
        version: su.version,
        timestamp: su.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Vehicle')) {
      const vehicles = await prisma.vehicle.findMany({
        where: { updatedAt: { gt: lastSyncDate }, isDeleted: false },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });
      changes.push(...vehicles.map(vh => ({
        entityType: 'Vehicle',
        entityId: vh.id,
        operation: 'UPDATE',
        data: vh,
        version: vh.version,
        timestamp: vh.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Payment')) {
      const payments = await prisma.payment.findMany({
        where: { updatedAt: { gt: lastSyncDate } },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });
      changes.push(...payments.map(pm => ({
        entityType: 'Payment',
        entityId: pm.id,
        operation: 'UPDATE',
        data: pm,
        version: pm.version,
        timestamp: pm.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Employee')) {
      const employees = await prisma.employee.findMany({
        where: { updatedAt: { gt: lastSyncDate }, isDeleted: false },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });
      changes.push(...employees.map(em => ({
        entityType: 'Employee',
        entityId: em.id,
        operation: 'UPDATE',
        data: em,
        version: em.version,
        timestamp: em.updatedAt.toISOString(),
      })));
    }

    if (!entityTypes || entityTypes.includes('Purchase')) {
      const purchases = await prisma.purchase.findMany({
        where: { updatedAt: { gt: lastSyncDate }, isDeleted: false },
        take: limit,
        orderBy: { updatedAt: 'asc' },
        include: { items: true },
      });
      changes.push(...purchases.map(pu => ({
        entityType: 'Purchase',
        entityId: pu.id,
        operation: 'UPDATE',
        data: pu,
        version: pu.version,
        timestamp: pu.updatedAt.toISOString(),
      })));
    }

    // Check for deleted entities via syncLog
    const deletedLogs = await prisma.syncLog.findMany({
      where: {
        operation: 'DELETE',
        status: 'SYNCED',
        updatedAt: { gt: lastSyncDate },
        ...(entityTypes ? { entityType: { in: entityTypes } } : {}),
      },
      take: limit,
      orderBy: { updatedAt: 'asc' },
    });

    changes.push(...deletedLogs.map(log => ({
      entityType: log.entityType,
      entityId: log.entityId,
      operation: 'DELETE',
      version: log.version,
      timestamp: log.updatedAt.toISOString(),
    })));

    // Update sync metadata
    await prisma.syncMetadata.upsert({
      where: { deviceId },
      create: {
        deviceId,
        userId,
        lastPullAt: new Date(),
        lastSyncAt: new Date(),
      },
      update: {
        lastPullAt: new Date(),
        lastSyncAt: new Date(),
        userId,
      }
    });

    res.json({
      changes,
      count: changes.length,
      timestamp: new Date().toISOString(),
      hasMore: changes.length >= limit,
    });

  } catch (error) {
    console.error('Sync pull error:', error);
    res.status(500).json({ error: 'Sync pull failed' });
  }
});

// GET /api/sync/status - Get sync status
router.get('/status', async (req: AuthenticatedRequest, res) => {
  try {
    const deviceId = req.query.deviceId as string;
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId required' });
    }

    const metadata = await prisma.syncMetadata.findUnique({
      where: { deviceId }
    });

    const pendingCount = await prisma.syncLog.count({
      where: { deviceId, status: 'PENDING' }
    });

    const failedCount = await prisma.syncLog.count({
      where: { deviceId, status: 'FAILED' }
    });

    const conflictCount = await prisma.syncLog.count({
      where: { deviceId, status: 'CONFLICT' }
    });

    const recentLogs = await prisma.syncLog.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({
      deviceId,
      metadata,
      counts: {
        pending: pendingCount,
        failed: failedCount,
        conflict: conflictCount,
      },
      recentLogs,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// POST /api/sync/resolve-conflict
router.post('/resolve-conflict', async (req: AuthenticatedRequest, res) => {
  try {
    const schema = z.object({
      syncLogId: z.string().uuid(),
      resolution: z.enum(['CLIENT_WINS', 'SERVER_WINS', 'MERGE']),
      mergedData: z.any().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { syncLogId, resolution, mergedData } = parsed.data;

    const log = await prisma.syncLog.findUnique({ where: { id: syncLogId } });
    if (!log) return res.status(404).json({ error: 'Sync log not found' });

    if (log.status !== 'CONFLICT') {
      return res.status(400).json({ error: 'Log is not in conflict status' });
    }

    let newStatus: any = 'SYNCED';
    let finalData = null;

    if (resolution === 'CLIENT_WINS') {
      finalData = log.conflictData ? JSON.parse(log.conflictData).clientData : null;
      // In real implementation, apply client data to entity
    } else if (resolution === 'SERVER_WINS') {
      finalData = log.conflictData ? JSON.parse(log.conflictData).serverData : null;
    } else if (resolution === 'MERGE') {
      finalData = mergedData;
    }

    const updated = await prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: newStatus,
        payload: finalData ? JSON.stringify(finalData) : log.payload,
        syncedAt: new Date(),
        errorMessage: null,
      }
    });

    res.json({
      message: `Conflict resolved with ${resolution}`,
      log: updated,
    });
  } catch (error) {
    console.error('Resolve conflict error:', error);
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
});

export default router;

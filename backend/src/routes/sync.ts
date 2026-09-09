import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
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
              await prisma.customer.create({
                data: {
                  id: entityId,
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
                }
              });
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
              await prisma.product.create({
                data: {
                  id: entityId,
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
                }
              });
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

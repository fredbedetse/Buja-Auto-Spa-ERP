// Shared parts-line builder + stock reservation for maintenance orders.
// Used by both the REST route and the sync push branch so the math is identical.
import prisma from './prisma';

export type MaintInputLine = { productId: string; qty: number };
export type MaintStoredLine = { productId: string; sku: string; name: string; qty: number; unitPrice: number; lineTotal: number };

/** Resolve client line intents against live products. Missing/inactive products are
 *  dropped (reported as warnings) - money always comes from server-side truth. */
export async function buildMaintLines(lines: MaintInputLine[]): Promise<{ rows: MaintStoredLine[]; warnings: string[] }> {
  const warnings: string[] = [];
  const qtyByProduct = new Map<string, number>();
  for (const l of lines || []) {
    if (!l?.productId) continue;
    const q = Math.min(9999, Math.max(1, Math.round(l.qty || 0)));
    qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) || 0) + q);
  }
  if (!qtyByProduct.size) return { rows: [], warnings };
  const ids = [...qtyByProduct.keys()];
  const products = await prisma.product.findMany({ where: { id: { in: ids }, isDeleted: false } });
  const byId = new Map(products.map(p => [p.id, p]));
  const rows: MaintStoredLine[] = [];
  for (const [pid, qty] of qtyByProduct) {
    const p = byId.get(pid);
    if (!p || !p.isActive) { warnings.push(`part dropped: ${pid.slice(0, 8)}`); continue; }
    const unitPrice = p.sellingPrice || 0;
    rows.push({ productId: p.id, sku: p.sku, name: p.name, qty, unitPrice, lineTotal: qty * unitPrice });
  }
  return { rows, warnings };
}

export const linesTotal = (rows: MaintStoredLine[]) => rows.reduce((s, r) => s + (r.lineTotal || 0), 0);

/** Consume (+) or release (-) stock. Throws {code:'INSUFFICIENT_STOCK', sku} on shortfall. */
export async function applyMaintStock(rows: MaintStoredLine[], delta: number, client: any = prisma) {
  if (!rows.length || delta === 0) return;
  for (const r of rows) {
    const qty = Math.max(1, r.qty || 1);
    if (delta > 0) {
      const res = await client.product.updateMany({ where: { id: r.productId, stockQuantity: { gte: qty } }, data: { stockQuantity: { decrement: qty }, updatedAt: new Date() } });
      if (res.count === 0) throw { code: 'INSUFFICIENT_STOCK', sku: r.sku, need: qty };
    } else {
      await client.product.update({ where: { id: r.productId }, data: { stockQuantity: { increment: qty }, updatedAt: new Date() } }).catch(() => undefined);
    }
  }
}

/** Best-effort variant for sync replays: never fails the change, reports what was skipped. */
export async function tryApplyMaintStock(rows: MaintStoredLine[], delta: number, client: any = prisma): Promise<string[]> {
  const warns: string[] = [];
  if (!rows.length || delta === 0) return warns;
  for (const r of rows) {
    const qty = Math.max(1, r.qty || 1);
    if (delta > 0) {
      const res = await client.product.updateMany({ where: { id: r.productId, stockQuantity: { gte: qty } }, data: { stockQuantity: { decrement: qty }, updatedAt: new Date() } });
      if (res.count === 0) warns.push(`stock not reserved: ${r.sku}`);
    } else {
      await client.product.update({ where: { id: r.productId }, data: { stockQuantity: { increment: qty }, updatedAt: new Date() } }).catch(() => undefined);
    }
  }
  return warns;
}

export const parseLines = (json: string | null | undefined): MaintStoredLine[] => {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Per-product net movement between two states: {consume, release}.
 *  Only the delta touches stock when lines are edited mid-job. */
export function diffStock(oldRows: MaintStoredLine[], newRows: MaintStoredLine[], wasConsuming: boolean, nowConsuming: boolean) {
  const oldQty = new Map<string, number>(); const newQty = new Map<string, number>();
  const lineOf = new Map<string, MaintStoredLine>();
  if (wasConsuming) for (const r of oldRows) oldQty.set(r.productId, (oldQty.get(r.productId) || 0) + Math.max(1, r.qty || 1));
  if (nowConsuming) for (const r of newRows) newQty.set(r.productId, (newQty.get(r.productId) || 0) + Math.max(1, r.qty || 1));
  const consume: MaintStoredLine[] = []; const release: MaintStoredLine[] = [];
  for (const [pid, q] of newQty) {
    const d = q - (oldQty.get(pid) || 0);
    if (d > 0) consume.push({ ...(lineOf.get(pid) || newRows.find(r => r.productId === pid)!), qty: d });
  }
  for (const [pid, q] of oldQty) {
    const d = q - (newQty.get(pid) || 0);
    if (d > 0) release.push({ ...oldRows.find(r => r.productId === pid)!, qty: d });
  }
  return { consume, release };
}

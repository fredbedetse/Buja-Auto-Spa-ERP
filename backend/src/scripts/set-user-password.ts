// Rotate a user's password on a live DB without the UI (used to kill demo creds):
//   EMAIL=manager@bujaautospa.bi NEW_PASSWORD='S0me!Strong-pw' npx tsx src/scripts/set-user-password.ts
// Revokes that user's sessions so old tokens stop working immediately.
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
(async () => {
  const email = process.env.EMAIL;
  const pw = process.env.NEW_PASSWORD;
  if (!email || !pw || pw.length < 10) { console.error('usage: EMAIL=... NEW_PASSWORD=...(min 10 chars) npx tsx src/scripts/set-user-password.ts'); process.exit(1); }
  const p = new PrismaClient();
  const hash = await bcrypt.hash(pw, 12);
  const r = await p.user.update({ where: { email }, data: { passwordHash: hash, version: { increment: 1 } }, select: { id: true, email: true } });
  const killed = await p.session.updateMany({ where: { userId: r.id }, data: { isRevoked: true } });
  await p.$disconnect();
  console.log(`password rotated for ${r.email}; revoked ${killed.count} session(s)`);
})().catch(e => { console.error(e); process.exit(1); });

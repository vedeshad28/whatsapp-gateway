// One-time bootstrap: mints the first Client + API key.
//
// There's no dashboard login in this gateway (API-key-only auth), so
// nothing can call POST /api/v1/accounts until at least one key exists.
// Run this once per calling application (e.g. once for "salon-saas"),
// then put the printed key in that app's WHATSAPP_GATEWAY_API_KEY env var.
//
// Usage: node scripts/create-client.js "salon-saas" accounts:manage messages:send templates:manage webhooks:manage messages:read

const { PrismaClient } = require('@prisma/client');
const { randomBytes, createHash } = require('node:crypto');

async function main() {
  const [name, ...scopes] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: node scripts/create-client.js <client-name> [scope ...]');
    process.exit(1);
  }
  const grantedScopes = scopes.length
    ? scopes
    : ['accounts:manage', 'messages:send', 'messages:read', 'templates:manage', 'webhooks:manage'];

  const prisma = new PrismaClient();
  try {
    const client = await prisma.client.create({ data: { name } });

    const body = randomBytes(32).toString('base64url');
    const plaintext = `wagw_live_${body}`;
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const keyPrefix = `wagw_live_${body.slice(0, 8)}`;

    await prisma.apiKey.create({
      data: { clientId: client.id, name: `${name} bootstrap key`, keyPrefix, keyHash, scopes: grantedScopes },
    });

    console.log(`Client created: ${client.id} (${name})`);
    console.log(`API key (shown once — save it now):\n  ${plaintext}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

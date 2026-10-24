import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';

// Load server/.env (for TEST_MONGODB_URI) without overriding variables already set.
try {
  process.loadEnvFile?.(new URL('../.env', import.meta.url));
} catch {
  /* no .env file - fall back to the in-memory server */
}

// Must be set before any src module (env.js validates on import).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
process.env.MONGODB_URI = 'mongodb://placeholder-replaced-in-tests';
for (const key of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'COMPANY_NAME']) delete process.env[key];

let memoryServer;

async function resolveTestUri() {
  const uri = process.env.TEST_MONGODB_URI;
  if (uri) {
    // Every test wipes all collections, so refuse anything that is not clearly a test database.
    const dbName = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.slice(1);
    if (!dbName.endsWith('-test')) {
      throw new Error(`TEST_MONGODB_URI must point at a database ending in "-test" (got "${dbName || '(none)'}")`);
    }
    return uri;
  }
  // No test URI configured: start a throwaway local MongoDB (downloads a binary on first run).
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  return memoryServer.getUri();
}

// Raw collection deletes bypass model hooks (the audit log blocks deletes on purpose).
async function clearDatabase() {
  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
}

beforeAll(async () => {
  const { connectDB } = await import('../src/config/db.js');
  await connectDB(await resolveTestUri());
  // Build unique indexes before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  // Start clean even if a previous run or manual testing left data behind.
  await clearDatabase();
});

afterEach(clearDatabase);

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});

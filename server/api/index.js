// Vercel serverless entry: the same Express app as src/server.js, with the
// MongoDB connection reused across invocations of a warm function.
import { env } from '../src/config/env.js';
import { connectDB } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { bootstrapFromEnv } from '../src/services/setup.service.js';

const app = createApp();
let ready = null;

function ensureReady() {
  if (!ready) {
    ready = connectDB(env.MONGODB_URI)
      .then(() => bootstrapFromEnv(env))
      .catch((err) => {
        ready = null; // retry on the next request instead of caching the failure
        throw err;
      });
  }
  return ready;
}

export default async function handler(req, res) {
  try {
    await ensureReady();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'DB_UNAVAILABLE', message: 'The database is temporarily unreachable. Please try again in a moment.' } }));
    return;
  }
  return app(req, res);
}

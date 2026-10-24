import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { bootstrapFromEnv } from './services/setup.service.js';

async function main() {
  await connectDB(env.MONGODB_URI);
  console.info('MongoDB connected');

  await bootstrapFromEnv(env);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.info(`HCM Lite API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown so hosting restarts do not cut requests mid-way.
  const shutdown = (signal) => {
    console.info(`${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

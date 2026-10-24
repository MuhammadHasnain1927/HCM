import mongoose from 'mongoose';

// Strip `$` operators from query filters built from user input (NoSQL injection guard).
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);
// Commands issued while disconnected wait at most 10 s for the connection to come back.
mongoose.set('bufferTimeoutMS', 10000);

export async function connectDB(uri) {
  // Fail requests after ~10 s instead of hanging when the database is unreachable.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 30000 });
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

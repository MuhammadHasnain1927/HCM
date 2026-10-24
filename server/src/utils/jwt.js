import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// The token carries only the user id and token version; role and status are
// re-read from the database on every request so changes apply immediately.
export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), v: user.tokenVersion }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}

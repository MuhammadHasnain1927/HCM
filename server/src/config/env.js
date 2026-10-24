import { z } from 'zod';

// Validate environment variables once at startup so a missing secret fails fast
// with a clear message instead of a confusing error later.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  // Comma-separated list of allowed frontend origins, e.g. "http://localhost:5173,https://hcm.vercel.app"
  CLIENT_URL: z.string().default('http://localhost:5173'),

  // Optional first-run bootstrap: if set and no Admin exists yet, the server
  // creates the company and Admin account on startup (brief, Section 2).
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().optional(),
  COMPANY_NAME: z.string().optional(),

  // AI providers (used from the AI module onwards). Never sent to the browser.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  GROQ_VISION_MODEL: z.string().optional(),
});

// Treat empty values (e.g. "ADMIN_EMAIL=" copied from .env.example) as not set.
const raw = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ''),
);

const parsed = schema.safeParse(raw);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  clientOrigins: parsed.data.CLIENT_URL.split(',').map((s) => s.trim()).filter(Boolean),
};

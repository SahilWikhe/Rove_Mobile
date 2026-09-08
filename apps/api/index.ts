import { Hono } from 'hono';
import { createRuntime } from './src/runtime';

// Vercel's Hono entrypoint. No migrations, fixture seeding, timers or listener at module load.
const runtime = createRuntime(process.env);
export default new Hono().route('/', runtime.app);

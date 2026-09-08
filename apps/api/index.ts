import { waitUntil } from '@vercel/functions';
import { createHostedApp } from './src/hosted-app';
import { runtime, scheduler } from './src/deployment';

export default createHostedApp(runtime.app, scheduler, process.env.CRON_SECRET ?? '', waitUntil);

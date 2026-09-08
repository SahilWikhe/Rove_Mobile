import { getRequestListener } from '@hono/node-server';
import app from '../index';
export default getRequestListener(app.fetch);

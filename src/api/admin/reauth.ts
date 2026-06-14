import { Hono } from 'hono';
import { handleApiError } from './middleware.js';

export const reauthRoutes = new Hono();

const STUB_BODY = { error: 'not_implemented_yet', task: 15 };

reauthRoutes.post('/verify', (c) => {
  try {
    return c.json(STUB_BODY, 501);
  } catch (e) {
    return handleApiError(e);
  }
});

reauthRoutes.post('/clear', (c) => {
  try {
    return c.json(STUB_BODY, 501);
  } catch (e) {
    return handleApiError(e);
  }
});

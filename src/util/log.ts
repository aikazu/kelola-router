import pino from 'pino';
import { getLogLevel } from './env.js';

export const log = pino({
  level: getLogLevel(),
});

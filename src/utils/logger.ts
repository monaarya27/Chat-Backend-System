import pino from 'pino';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
const usePretty = process.env.NODE_ENV === 'development' && process.stdout.isTTY;

/** Structured JSON logger. Pretty-printed in an interactive dev terminal. */
export const logger = pino({
  level,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  ...(usePretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});

export type Logger = typeof logger;

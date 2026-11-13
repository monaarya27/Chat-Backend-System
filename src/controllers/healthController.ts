import type { Request, Response } from 'express';
import type { HealthCheck } from '../repositories/types';

export class HealthController {
  constructor(private readonly checks: HealthCheck[]) {}

  /** GET /health — liveness: the process is up. Does not touch databases. */
  live = (_req: Request, res: Response): void => {
    res.json({ success: true, status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  };

  /** GET /health/ready — readiness: really pings PostgreSQL and Firestore. */
  ready = async (_req: Request, res: Response): Promise<void> => {
    const results = await Promise.all(
      this.checks.map(async ({ name, check }) => {
        try {
          await check();
          return { name, status: 'up' as const };
        } catch (error) {
          return { name, status: 'down' as const, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    const allUp = results.every((result) => result.status === 'up');
    res.status(allUp ? 200 : 503).json({ success: allUp, status: allUp ? 'ready' : 'degraded', checks: results });
  };
}

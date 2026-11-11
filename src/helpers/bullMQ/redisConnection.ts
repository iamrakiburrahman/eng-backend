import IORedis from 'ioredis';
import colors from 'colors';
import { logger, errorLogger } from '../../shared/logger';
import config from '../../config';

const redisOptions: Record<string, any> = {
     maxRetriesPerRequest: null,
     enableReadyCheck: false,
     protocol: 2,
     db: config.redis.db ? Number(config.redis.db) : 0,
     ...(config.redis.username ? { username: config.redis.username } : {}),
     ...(config.redis.password ? { password: config.redis.password } : {}),
     retryStrategy: (times: number) => {
          const delay = Math.min(times * 200, 5000);
          return delay;
     },
};

// Redis connection for BullMQ
export const redisConnection = new IORedis(
     config.redis.url || 'redis://localhost:6379',
     redisOptions,
);

let lastAuthErrorLoggedAt = 0;

// Connection events
redisConnection.on('error', (err: any) => {
     const msg = err?.message || '';
     if (msg.includes('NOAUTH') || msg.includes('WRONGPASS') || msg.includes('AUTH')) {
          const now = Date.now();
          if (now - lastAuthErrorLoggedAt > 30000) {
               lastAuthErrorLoggedAt = now;
               errorLogger.error(
                    colors.red(
                         `❌ Redis (BullMQ) authentication error: ${msg} (check REDIS_URL or REDIS_PASSWORD in .env)`,
                    ),
               );
          }
          return;
     }
     errorLogger.error(colors.red(`❌ Redis (BullMQ) connection error: ${msg || err}`));
});

redisConnection.on('ready', () => {
     lastAuthErrorLoggedAt = 0;
     logger.info(colors.green('✅ Redis (BullMQ) connected & ready'));
});

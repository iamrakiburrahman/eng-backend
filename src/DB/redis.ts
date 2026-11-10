import { createClient, RedisClientOptions, RedisClientType } from 'redis';
import colors from 'colors';
import { logger, errorLogger } from '../shared/logger';
import config from '../config';

let redisClient: RedisClientType | null = null;
let isRedisConnected = false;

// ==========================================
// 1. MAIN REDIS CONFIG (For Caching & General Use)
// ==========================================
const REDIS_CONFIG: RedisClientOptions = {
     url: config.redis.url || 'redis://localhost:6379',
     ...(config.redis.username ? { username: config.redis.username } : {}),
     ...(config.redis.password ? { password: config.redis.password } : {}),
     socket: {
          connectTimeout: 10000,
          reconnectStrategy: (retries: number) => {
               if (retries > 10) {
                    errorLogger.error(colors.red('Redis: Too many reconnection attempts'));
                    return new Error('Redis reconnection failed');
               }
               const delay = Math.min(retries * 100, 3000);
               logger.info(colors.yellow(`Redis: Reconnecting in ${delay}ms (attempt ${retries})`));
               return delay;
          },
     },
     database: config.redis.db ? Number(config.redis.db) : 0, // Usually DB 0
};

// ==========================================
// 2. SOCKET SPECIFIC CONFIG (Isolation)
// ==========================================
const SOCKET_REDIS_CONFIG: RedisClientOptions = {
     ...REDIS_CONFIG,
     database: 2,
};

// Connect to Redis (Main Instance)
export async function connectToRedis() {
     try {
          redisClient = createClient(REDIS_CONFIG) as RedisClientType;

          setupRedisListeners();

          await redisClient.connect();
          isRedisConnected = true;
          logger.info(colors.bgBlue.white('🚀 Redis connected successfully (Main DB)'));
     } catch (error) {
          errorLogger.error(colors.red('Redis connection error:'), error);
          isRedisConnected = false;
          logger.warn(colors.yellow('⚠️  Application starting without Redis cache'));
     }
}

// Setup Redis event listeners
function setupRedisListeners(): void {
     if (!redisClient) return;

     redisClient.on('connect', () => {
          logger.info(colors.bgGreen.white('Redis: Connection established'));
     });

     redisClient.on('ready', () => {
          isRedisConnected = true;
          logger.info(colors.bgGreen.white('Redis: Ready to accept commands'));
     });

     redisClient.on('error', (err) => {
          isRedisConnected = false;
          errorLogger.error(colors.red('Redis error:'), err);
     });

     redisClient.on('reconnecting', () => {
          isRedisConnected = false;
          logger.warn(colors.yellow('Redis: Attempting to reconnect...'));
     });

     redisClient.on('end', () => {
          isRedisConnected = false;
          logger.warn(colors.yellow('Redis: Connection closed'));
     });
}

// Disconnect from Redis
export async function disconnectRedis(): Promise<void> {
     if (redisClient && isRedisConnected) {
          try {
               await redisClient.quit();
               logger.info(colors.green('✅ Redis disconnected gracefully'));
          } catch (error) {
               errorLogger.error(colors.red('Error disconnecting Redis:'), error);
               await redisClient.disconnect();
          }
     }
}

// Get Redis client
export function getRedisClient(): RedisClientType | null {
     return isRedisConnected ? redisClient : null;
}

// Check if Redis is connected
export function isRedisReady(): boolean {
     return isRedisConnected && redisClient !== null;
}

// ==========================================
// Helper for Socket.io Adapter Clients
// ==========================================
export async function createSocketRedisClients() {
     try {
          const pubClient = createClient(SOCKET_REDIS_CONFIG) as RedisClientType;
          const subClient = pubClient.duplicate();

          // Error handling
          pubClient.on('error', (err) =>
               errorLogger.error(colors.red('Socket Pub Client Error:'), err),
          );
          subClient.on('error', (err) =>
               errorLogger.error(colors.red('Socket Sub Client Error:'), err),
          );

          // Connect both
          await Promise.all([pubClient.connect(), subClient.connect()]);

          logger.info(colors.cyan('🔌 Socket.io Redis Adapter connected to DB 2'));

          return { pubClient, subClient };
     } catch (error) {
          errorLogger.error(colors.red('Failed to create Socket Redis clients:'), error);
          throw error;
     }
}

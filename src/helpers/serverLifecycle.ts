import http from 'http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import colors from 'colors';
import config from '../config';
import { logger, errorLogger } from '../shared/logger';
import seedSuperAdmin from '../DB';
import { connectToRedis, disconnectRedis, createSocketRedisClients } from '../DB/redis';
import { setupQueueEvents, setupWorkerEvents, closeBullMQ } from '../DB/bullMQ';
import { CleanupQueueHelper } from './bullMQ/bullHelper';
import { socketHelper } from './socketHelper';
import { corsOriginValidator } from './appLoaders';

export function isPrimaryClusterWorker(): boolean {
     const instanceId = process.env.INSTANCE_ID ?? process.env.NODE_APP_INSTANCE;
     return instanceId === undefined || instanceId === '0';
}

const backgroundTimers: ReturnType<typeof setInterval>[] = [];

export async function connectServices(): Promise<void> {
     const isPrimaryWorker = isPrimaryClusterWorker();

     // 1. Connect to MongoDB
     try {
          await mongoose.connect(config.database_url as string, {
               maxPoolSize: 20,
               minPoolSize: 2,
          });
          logger.info(colors.green('🚀 Database connected successfully'));
     } catch (dbError) {
          errorLogger.error(colors.red('🤢 Failed to connect to Database:'), dbError);
          throw dbError;
     }

     // 2. Seed Super Admin (Primary worker only to prevent multi-worker race conditions)
     if (isPrimaryWorker) {
          try {
               await seedSuperAdmin();
          } catch (seedError) {
               errorLogger.error(colors.red('🤢 Failed to seed Super Admin:'), seedError);
               throw seedError;
          }
     }

     // 3. Connect to Redis Caching
     try {
          await connectToRedis();
     } catch (redisError) {
          errorLogger.error(colors.red('🤢 Failed to connect to Redis:'), redisError);
          throw redisError;
     }

     // 4. Initialize BullMQ Queue & Worker Events + Schedule Repeatable Jobs
     try {
          if (isPrimaryWorker) {
               setupQueueEvents();
          }
          setupWorkerEvents();
          if (isPrimaryWorker) {
               await CleanupQueueHelper.scheduleRepeatableJobs();
          }
     } catch (bullMQError) {
          errorLogger.error(colors.red('🤢 Failed to initialize BullMQ:'), bullMQError);
          throw bullMQError;
     }

     // 5-7. Background schedulers & startup syncs (Primary worker only)
     if (isPrimaryWorker) {
          // 5. Periodic background auto-finish monitor for matches whose timer elapsed
          const matchTimerMonitor = setInterval(() => {
               import('../app/modules/match/match.service')
                    .then(({ checkAndFinishExpiredMatches }) => checkAndFinishExpiredMatches())
                    .catch(() => {});
          }, 30000);
          matchTimerMonitor.unref();
          backgroundTimers.push(matchTimerMonitor);

          // 6. Sync transferred players historical stats to ensure all past and present transfers carry forward
          import('./playerTransferStatsHelper')
               .then(({ syncAllApprovedTransfersStats }) => syncAllApprovedTransfersStats())
               .catch((err) => errorLogger.error('Failed to sync transfer stats on startup:', err));

          // 7. Check and send 1-day advance push notifications for upcoming matches
          import('./matchReminderHelper')
               .then(({ checkAndSendUpcomingMatchReminders }) => checkAndSendUpcomingMatchReminders())
               .catch((err) => errorLogger.error('Failed to run initial match reminders:', err));

          const matchReminderMonitor = setInterval(() => {
               import('./matchReminderHelper')
                    .then(({ checkAndSendUpcomingMatchReminders }) => checkAndSendUpcomingMatchReminders())
                    .catch(() => {});
          }, 10 * 60 * 1000);
          matchReminderMonitor.unref();
          backgroundTimers.push(matchReminderMonitor);
     }
}

export async function initSocketServer(server: http.Server): Promise<void> {
     const socketCors = {
          origin: corsOriginValidator,
          credentials: true,
     };

     let io: Server;
     try {
          const { pubClient, subClient } = await createSocketRedisClients();
          io = new Server(server, {
               pingTimeout: 60000,
               cors: socketCors,
               adapter: createAdapter(pubClient, subClient),
          });
          logger.info(colors.green('🚀 Socket.io initialized with Redis Adapter'));
     } catch (redisAdapterError) {
          errorLogger.error(
               colors.red('⚠️ Socket.io Redis Adapter failed. Falling back to memory adapter:'),
               redisAdapterError,
          );
          io = new Server(server, {
               pingTimeout: 60000,
               cors: socketCors,
          });
     }

     socketHelper.socket(io);
     global.io = io;
}

export async function closeServices(): Promise<void> {
     while (backgroundTimers.length > 0) {
          const timer = backgroundTimers.pop();
          if (timer) clearInterval(timer);
     }

     try {
          await mongoose.connection.close();
          logger.info(colors.green('✅ MongoDB connection closed gracefully'));
     } catch (err) {
          errorLogger.error('Error closing MongoDB connection:', err);
     }

     try {
          await disconnectRedis();
     } catch (err) {
          errorLogger.error('Error disconnecting Redis client:', err);
     }

     try {
          await closeBullMQ();
     } catch (err) {
          errorLogger.error('Error closing BullMQ:', err);
     }
}

export async function gracefulShutdown(signal: string, server: http.Server | any): Promise<void> {
     logger.info(colors.yellow(`\n${signal} received — gracefully shutting down...`));

     if (server) {
          // Force-close all idle keep-alive connections immediately
          server.closeAllConnections?.();

          server.close(async () => {
               logger.info(colors.gray('HTTP server closed cleanly.'));
               try {
                    await closeServices();
                    logger.info(colors.bgGreen.white('👋 Graceful shutdown complete.'));
               } catch (err) {
                    errorLogger.error('Error during graceful shutdown cleanup:', err);
               }
               process.exit(0); // Clean exit so ts-node-dev can restart on filesave
          });

          // Safety net: force-exit after 3s
          setTimeout(() => {
               logger.info(colors.red('Force exiting after 3s timeout'));
               process.exit(0);
          }, 3000).unref();
     } else {
          process.exit(0);
     }
}

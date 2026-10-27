import { QueueEvents } from 'bullmq';
import colors from 'colors';
import { logger, errorLogger } from '../shared/logger';
import {
     cleanupQueue,
     emailQueue,
     notificationQueue,
     smsQueue,
} from '../helpers/bullMQ/bullQueueInstance';
import { redisConnection } from '../helpers/bullMQ/redisConnection';
import { QUEUE_NAMES } from '../helpers/bullMQ/bullInterface';

export { redisConnection };

// ==========================================
// QUEUE EVENTS FOR MONITORING
// ==========================================
const emailQueueEvents = new QueueEvents(QUEUE_NAMES.EMAIL, { connection: redisConnection });
const notificationQueueEvents = new QueueEvents(QUEUE_NAMES.NOTIFICATION, {
     connection: redisConnection,
});
const smsQueueEvents = new QueueEvents(QUEUE_NAMES.SMS, { connection: redisConnection });
const cleanupQueueEvents = new QueueEvents(QUEUE_NAMES.CLEANUP, { connection: redisConnection });

// Prevent unhandled Redis error crashes on duplicated QueueEvents connections
[emailQueueEvents, notificationQueueEvents, smsQueueEvents, cleanupQueueEvents].forEach((qe) => {
     qe.on('error', () => {
          // Handled silently since redisConnection.on('error') logs the error
     });
});

// ==========================================
// SETUP QUEUE EVENTS
// ==========================================
export function setupQueueEvents(): void {
     // Email Queue Events
     emailQueueEvents.on('completed', ({ jobId }) => {
          logger.info(colors.green(`[BullMQ] Email job ${jobId} completed`));
     });
     emailQueueEvents.on('failed', ({ jobId, failedReason }) => {
          errorLogger.error(colors.red(`[BullMQ] Email job ${jobId} failed: ${failedReason}`));
     });

     // Notification Queue Events
     notificationQueueEvents.on('completed', ({ jobId }) => {
          logger.info(colors.green(`[BullMQ] Notification job ${jobId} completed`));
     });
     notificationQueueEvents.on('failed', ({ jobId, failedReason }) => {
          errorLogger.error(colors.red(`[BullMQ] Notification job ${jobId} failed: ${failedReason}`));
     });

     // SMS Queue Events
     smsQueueEvents.on('completed', ({ jobId }) => {
          logger.info(colors.green(`[BullMQ] SMS job ${jobId} completed`));
     });
     smsQueueEvents.on('failed', ({ jobId, failedReason }) => {
          errorLogger.error(colors.red(`[BullMQ] SMS job ${jobId} failed: ${failedReason}`));
     });

     // Cleanup Queue Events
     cleanupQueueEvents.on('completed', ({ jobId }) => {
          logger.info(colors.green(`[BullMQ] Cleanup job ${jobId} completed`));
     });
     cleanupQueueEvents.on('failed', ({ jobId, failedReason }) => {
          errorLogger.error(colors.red(`[BullMQ] Cleanup job ${jobId} failed: ${failedReason}`));
     });

     logger.info(colors.bgBlue.white('[BullMQ] Queue events initialized for all queues'));
}

// ==========================================
// SETUP WORKER EVENTS (call this from server.ts)
// ==========================================
export function setupWorkerEvents(): void {
     const {
          emailWorker,
          notificationWorker,
          smsWorker,
          cleanupWorker,
     } = require('../helpers/bullMQ/bullWorkers');

     emailWorker.on('completed', (job: any) => {
          logger.info(colors.green(`[BullMQ] Email worker job ${job.id} completed`));
     });

     emailWorker.on('failed', (job: any, err: any) => {
          errorLogger.error(colors.red(`[BullMQ] Email worker job ${job?.id} failed: ${err.message}`));
     });

     notificationWorker.on('completed', (job: any) => {
          logger.info(colors.green(`[BullMQ] Notification worker job ${job.id} completed`));
     });

     notificationWorker.on('failed', (job: any, err: any) => {
          errorLogger.error(
               colors.red(`[BullMQ] Notification worker job ${job?.id} failed: ${err.message}`),
          );
     });

     smsWorker.on('completed', (job: any) => {
          logger.info(colors.green(`[BullMQ] SMS worker job ${job.id} completed`));
     });

     smsWorker.on('failed', (job: any, err: any) => {
          errorLogger.error(colors.red(`[BullMQ] SMS worker job ${job?.id} failed: ${err.message}`));
     });

     cleanupWorker.on('completed', (job: any) => {
          logger.info(colors.green(`[BullMQ] Cleanup worker job ${job.id} completed`));
     });

     cleanupWorker.on('failed', (job: any, err: any) => {
          errorLogger.error(colors.red(`[BullMQ] Cleanup worker job ${job?.id} failed: ${err.message}`));
     });

     logger.info(colors.bgMagenta.white('[BullMQ] All BullMQ worker events initialized'));
}

export function getAllQueues() {
     return {
          email: emailQueue,
          notification: notificationQueue,
          sms: smsQueue,
          cleanup: cleanupQueue,
     };
}

export async function getQueueStats(queueName: string) {
     const queues = getAllQueues();
     const queue = queues[queueName as keyof typeof queues];

     if (!queue) {
          throw new Error(`Queue ${queueName} not found`);
     }

     const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
          queue.isPaused(),
     ]);

     return {
          name: queueName,
          waiting,
          active,
          completed,
          failed,
          delayed,
          paused,
          total: waiting + active + delayed,
     };
}

// Get all queues stats
export async function getAllQueuesStats() {
     const queueNames = Object.keys(getAllQueues());
     const stats = await Promise.all(queueNames.map((name) => getQueueStats(name)));

     return stats;
}

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
export async function closeBullMQ(): Promise<void> {
     try {
          logger.info(colors.yellow('⏳ Closing BullMQ queues...'));

          const {
               emailWorker,
               notificationWorker,
               smsWorker,
               cleanupWorker,
          } = require('../helpers/bullMQ/bullWorkers');

          await Promise.all([
               emailQueue.close(),
               notificationQueue.close(),
               smsQueue.close(),
               cleanupQueue.close(),
               emailQueueEvents.close(),
               notificationQueueEvents.close(),
               smsQueueEvents.close(),
               cleanupQueueEvents.close(),
               emailWorker.close(),
               notificationWorker.close(),
               smsWorker.close(),
               cleanupWorker.close(),
          ]);

          await redisConnection.quit();

          logger.info(colors.green('✅ All BullMQ queues closed'));
     } catch (error) {
          errorLogger.error(colors.red('Error closing BullMQ:'), error);
          throw error;
     }
}

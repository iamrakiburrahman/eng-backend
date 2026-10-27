import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection';
import {
     CleanupJobData,
     EmailJobData,
     NotificationJobData,
     QUEUE_NAMES,
     SMSJobData,
} from './bullInterface';

export const emailQueue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, {
     connection: redisConnection,
     defaultJobOptions: {
          attempts: 3,
          backoff: {
               type: 'exponential',
               delay: 2000,
          },
          removeOnComplete: {
               count: 100,
               age: 24 * 3600,
          },
          removeOnFail: {
               count: 500,
          },
     },
});

export const notificationQueue = new Queue<NotificationJobData>(QUEUE_NAMES.NOTIFICATION, {
     connection: redisConnection,
     defaultJobOptions: {
          attempts: 2,
          backoff: {
               type: 'fixed',
               delay: 5000,
          },
          removeOnComplete: {
               count: 50,
               age: 12 * 3600,
          },
     },
});

export const smsQueue = new Queue<SMSJobData>(QUEUE_NAMES.SMS, {
     connection: redisConnection,
     defaultJobOptions: {
          attempts: 3,
          backoff: {
               type: 'exponential',
               delay: 3000,
          },
          removeOnComplete: {
               count: 100,
               age: 24 * 3600,
          },
     },
});

export const cleanupQueue = new Queue<CleanupJobData>(QUEUE_NAMES.CLEANUP, {
     connection: redisConnection,
     defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
     },
});

// Attach error handlers to prevent unhandled 'error' event exceptions
[emailQueue, notificationQueue, smsQueue, cleanupQueue].forEach((queue) => {
     queue.on('error', (err) => {
          // Error is also logged on redisConnection
     });
});

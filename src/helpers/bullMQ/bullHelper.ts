import colors from 'colors';
import { errorLogger, logger } from '../../shared/logger';
import { JobPriority, NotificationJobData } from './bullInterface';
import { JobOptionsPresets } from './bullPreset';
import { cleanupQueue, emailQueue, notificationQueue, smsQueue } from './bullQueueInstance';
import {
     clearDuplicateNotification,
     generateTeamNotificationDedupKey,
     generateUserNotificationDedupKey,
     isDuplicateNotification,
} from '../dedupHelper';

// ==========================================
// EMAIL QUEUE HELPERS
// ==========================================
export class EmailQueueHelper {
     static async sendWelcomeEmail(userEmail: string, userName: string, otp: string) {
          try {
               const job = await emailQueue.add(
                    'welcome-email',
                    {
                         to: userEmail,
                         subject: 'Verify your account',
                         template: 'createAccount',
                         data: {
                              name: userName,
                              otp,
                         },
                    },
                    JobOptionsPresets.CRITICAL,
               );

               logger.info(
                    colors.green(`[BullMQ] Welcome email queued for ${userEmail} - Job ID: ${job.id}`),
               );
               return job.id;
          } catch (error) {
               logger.error(colors.red('Failed to queue welcome email:'), error);
               throw error;
          }
     }

     static async sendPasswordResetEmail(userEmail: string, otp: string) {
          try {
               const job = await emailQueue.add(
                    'password-reset',
                    {
                         to: userEmail,
                         subject: 'Reset your password',
                         template: 'resetPassword',
                         data: { otp },
                    },
                    JobOptionsPresets.CRITICAL,
               );

               logger.info(colors.green(`[BullMQ] Password reset email queued - Job ID: ${job.id}`));
               return job.id;
          } catch (error) {
               logger.error(colors.red('Failed to queue password reset email:'), error);
               throw error;
          }
     }

     static async sendBulkEmails(users: Array<{ email: string; name: string; data?: any }>) {
          try {
               const jobs = users.map((user) => ({
                    name: 'bulk-email',
                    data: {
                         to: user.email,
                         subject: 'Important Update',
                         template: 'update',
                         data: { name: user.name, ...user.data },
                    },
                    opts: {
                         attempts: 2,
                         priority: JobPriority.NORMAL,
                    },
               }));

               const addedJobs = await emailQueue.addBulk(jobs);
               logger.info(colors.green(`[BullMQ] ${addedJobs.length} bulk emails queued`));
               return addedJobs.map((j) => j.id);
          } catch (error) {
               logger.error(colors.red('Failed to queue bulk emails:'), error);
               throw error;
          }
     }
}

// ==========================================
// NOTIFICATION QUEUE HELPERS
// ==========================================
export class NotificationQueueHelper {
     static async sendNotification(
          userId: string,
          message: string,
          title?: string,
          type: string = 'SYSTEM',
          receiverRole?: any,
          reference?: string,
          referenceModel?: string,
     ) {
          let dedupKey = '';
          try {
               dedupKey = generateUserNotificationDedupKey({
                    userId,
                    type,
                    reference,
                    title,
               });

               // Deduplicate rapid duplicate triggers within 15 seconds
               if (isDuplicateNotification(dedupKey, 15)) {
                    return null;
               }

               const cleanDedup = dedupKey ? dedupKey.replace(/[:\s\r\n]+/g, '_') : 'user_job';
                const job = await notificationQueue.add(
                    'notification',
                    {
                         userId,
                         title,
                         message,
                         type,
                         channels: ['in-app', 'socket', 'push'],
                         receiverRole,
                         reference,
                         referenceModel,
                    },
                    {
                         jobId: dedupKey ? cleanDedup + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000) : undefined,
                         priority: JobPriority.NORMAL,
                         attempts: 3,
                         backoff: {
                              type: 'exponential',
                              delay: 2000,
                         },
                         removeOnComplete: { age: 300 },
                    },
               );

               logger.info(
                    colors.green(`[BullMQ] Notification queued for ${userId} - Job ID: ${job.id}`),
               );
               return job.id;
          } catch (error) {
               clearDuplicateNotification(dedupKey);
                logger.error(colors.red('Failed to queue notification:'), error);
                return null;
          }
     }

     static async sendBulkNotifications(
          userIds: string[],
          title: string,
          message: string,
          type: string = 'SYSTEM',
          receiverRole?: any,
          reference?: string,
          referenceModel?: string,
     ) {
          try {
               // Deduplicate userIds in bulk list
               const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
               const jobs = uniqueUserIds.map((userId) => ({
                    name: 'bulk-notification',
                    data: {
                         userId,
                         title,
                         message,
                         type,
                         channels: ['in-app', 'socket', 'push'] as Array<'push' | 'in-app' | 'socket'>,
                         receiverRole,
                         reference,
                         referenceModel,
                    },
               }));

               const addedJobs = await notificationQueue.addBulk(jobs);
               logger.info(colors.green(`[BullMQ] ${addedJobs.length} notifications queued`));
               return addedJobs.map((j) => j.id);
          } catch (error) {
               logger.error(colors.red('Failed to queue bulk notifications:'), error);
               throw error;
          }
     }

     static async notifyTeamSubscribers(
          teamId: string,
          title: string,
          message: string,
          type: string = 'TEAM_UPDATE',
          reference?: string,
          referenceModel?: string,
          data?: Record<string, any>,
     ) {
          let dedupKey = '';
          try {
               dedupKey =
                    data?.dedupKey ||
                    generateTeamNotificationDedupKey({
                         teamId,
                         type,
                         eventType: data?.eventType,
                         referenceId: reference,
                         minute: data?.minute,
                         playerId: data?.playerId,
                         action: data?.action,
                          period: data?.period,
                    });

               // Deduplicate rapid duplicate clicks within 15 seconds
               if (isDuplicateNotification(dedupKey, 15)) {
                    return null;
               }

               const cleanDedup = dedupKey ? dedupKey.replace(/[:\s\r\n]+/g, '_') : 'team_job';
               const job = await notificationQueue.add(
                    'team-subscriber-notification',
                    {
                         teamId,
                         title,
                         message,
                         type,
                         reference,
                         referenceModel,
                         data: {
                              ...data,
                              dedupKey,
                         },
                    },
                    {
                         jobId: `${cleanDedup}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                         priority: JobPriority.NORMAL,
                         attempts: 3,
                         backoff: {
                              type: 'exponential',
                              delay: 2000,
                         },
                         removeOnComplete: { age: 300, count: 500 },
                    },
               );

               logger.info(
                    colors.green(`[BullMQ] Team subscriber notification queued for team ${teamId} - Job ID: ${job.id}`),
               );
               return job.id;
          } catch (error) {
               clearDuplicateNotification(dedupKey);
                logger.error(colors.red(`Failed to queue team subscriber notification for team ${teamId}:`), error);
                return null;
          }
     }
}

// ==========================================
// SMS QUEUE HELPERS
// ==========================================
export class SMSQueueHelper {
     static async sendOTP(phone: string, otp: string, countryCode: string = '+880') {
          try {
               const job = await smsQueue.add(
                    'otp-sms',
                    {
                         phone,
                         message: `Your OTP is: ${otp}. Valid for 5 minutes.`,
                         countryCode,
                    },
                    JobOptionsPresets.CRITICAL,
               );

               logger.info(colors.green(`[BullMQ] OTP SMS queued for ${phone} - Job ID: ${job.id}`));
               return job.id;
          } catch (error) {
               logger.error(colors.red('Failed to queue OTP SMS:'), error);
               throw error;
          }
     }

     static async sendSMS(phone: string, message: string) {
          try {
               const job = await smsQueue.add('notification-sms', {
                    phone,
                    message,
               });

               logger.info(colors.green(`[BullMQ] SMS queued for ${phone} - Job ID: ${job.id}`));
               return job.id;
          } catch (error) {
               logger.error(colors.red('Failed to queue SMS:'), error);
               throw error;
          }
     }

     static async sendBulkSMS(recipients: Array<{ phone: string; message: string }>) {
          try {
               const jobs = recipients.map(({ phone, message }) => ({
                    name: 'bulk-sms',
                    data: { phone, message },
                    opts: { attempts: 2 },
               }));

               const addedJobs = await smsQueue.addBulk(jobs);
               logger.info(colors.green(`[BullMQ] ${addedJobs.length} SMS queued`));
               return addedJobs.map((j) => j.id);
          } catch (error) {
               logger.error(colors.red('Failed to queue bulk SMS:'), error);
               throw error;
          }
     }
}

// ==========================================
// CLEANUP & REPEATABLE QUEUE HELPERS (BULLMQ)
// ==========================================
export class CleanupQueueHelper {
     static async scheduleRepeatableJobs() {
          try {
               await cleanupQueue.add(
                    'subscription-sync',
                    { type: 'subscription-sync' },
                    { repeat: { pattern: '0 0 * * *' } } as any
               );

               await cleanupQueue.add(
                    'unverified-users',
                    { type: 'unverified-users' },
                    { repeat: { pattern: '*/15 * * * *' } } as any
               );

               await cleanupQueue.add(
                    'scheduled-news-sync',
                    { type: 'scheduled-news-sync' },
                    { repeat: { pattern: '*/5 * * * *' } } as any
               );

               await cleanupQueue.add(
                    'upcoming-match-reminders',
                    { type: 'upcoming-match-reminders' },
                    { repeat: { pattern: '*/10 * * * *' } } as any
               );

               await cleanupQueue.add(
                    'tournament-status-sync',
                    { type: 'tournament-status-sync' },
                    { repeat: { pattern: '*/5 * * * *' } } as any
               );

               logger.info(colors.green('[BullMQ] Repeatable background jobs scheduled successfully in Redis'));
          } catch (error) {
               logger.error(colors.red('Failed to schedule BullMQ background jobs:'), error);
          }
     }
}

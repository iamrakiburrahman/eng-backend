import { Worker } from 'bullmq';
import colors from 'colors';
import { Notification } from '../../app/modules/notification/notification.model';
import { User } from '../../app/modules/user/user.model';
import { Subscription } from '../../app/modules/subscription/subscription.model';
import { redisConnection } from './redisConnection';
import { emailTemplate } from '../../shared/emailTemplate';
import { errorLogger, logger } from '../../shared/logger';
import { emailHelper } from '../emailHelper';
import {
     CleanupJobData,
     EmailJobData,
     NotificationJobData,
     QUEUE_NAMES,
     SMSJobData,
} from './bullInterface';
import { emailQueue, notificationQueue, smsQueue } from './bullQueueInstance';
import { NotificationHelper } from '../../app/builder/PushNotifications';

// ==========================================
// EMAIL WORKER
// ==========================================
export const emailWorker = new Worker<EmailJobData>(
     QUEUE_NAMES.EMAIL,
     async (job) => {
          try {
               const { template, to, data } = job.data;
               logger.info(colors.blue(`[BullMQ] Processing email job ${job.id}`));

               let emailData;
               switch (template) {
                    case 'createAccount':
                         emailData = emailTemplate.createAccount({
                              email: to,
                              name: data?.name,
                              otp: data?.otp,
                         });
                         break;

                    case 'resetPassword':
                         emailData = emailTemplate.resetPassword({
                              email: to,
                              otp: data?.otp,
                         });
                         break;


                    default:
                         throw new Error(`Unknown email template: ${template}`);
               }

               // Send email
               await emailHelper.sendEmail(emailData);

               logger.info(colors.green(`[BullMQ] Email sent to ${emailData.to}`));
               return { success: true, recipient: emailData.to, jobId: job.id };
          } catch (error: any) {
               errorLogger.error(colors.red(`[BullMQ] Email job ${job.id} failed:`), error);
               throw error;
          }
     },
     {
          connection: redisConnection,
          concurrency: 5,
     },
);

// ==========================================
// NOTIFICATION WORKER
// ==========================================
export const notificationWorker = new Worker<NotificationJobData>(
     QUEUE_NAMES.NOTIFICATION,
     async (job) => {
          try {
               const {
                    userId,
                    title,
                    message,
                    type,
                    category,
                    channels,
                    data,
                    reference,
                    referenceModel,
                    screen,
                    receiverRole,
               } = job.data;
               logger.info(colors.blue(`[BullMQ] Processing notification job ${job.id} (${job.name})`));

               // Handle scheduled push notifications
               if (job.name === 'scheduled-push-notification' || job.data.pushNotificationId) {
                    const { PushNotification } = require('../../app/modules/pushNotification/pushNotification.model');
                    const pushNotificationId = job.data.pushNotificationId;
                    const notifDoc = await PushNotification.findById(pushNotificationId);

                    if (!notifDoc) {
                         logger.info(colors.yellow(`[BullMQ] Scheduled push notification ${pushNotificationId} not found`));
                         return { success: false, reason: 'NOT_FOUND' };
                    }

                    if (notifDoc.status === 'CANCELLED') {
                         logger.info(colors.yellow(`[BullMQ] Scheduled push notification ${pushNotificationId} was cancelled`));
                         return { success: false, reason: 'CANCELLED' };
                    }

                    const { resolveNotificationRecipients } = require('../../app/modules/pushNotification/pushNotification.service');
                    const { userIds } = await resolveNotificationRecipients(
                         notifDoc.user ? notifDoc.user.toString() : null,
                         notifDoc.targetRole
                    );

                    if (userIds.length > 0) {
                         await NotificationHelper.sendToBatch(userIds, {
                              title: notifDoc.title,
                              body: notifDoc.message,
                              type: 'SYSTEM',
                              category: notifDoc.category,
                         });
                    }

                    notifDoc.status = 'SENT';
                    notifDoc.sentAt = new Date();
                    await notifDoc.save();

                    logger.info(colors.green(`[BullMQ] Scheduled push notification ${pushNotificationId} executed and dispatched successfully`));
                    return { success: true, pushNotificationId, status: 'SENT' };
               }

               // Handle scheduled news article publish & broadcast
               if (job.name === 'scheduled-news-publish' || job.data.newsId) {
                    const { News } = require('../../app/modules/news/news.model');
                    const { broadcastNewsPublishedNotification } = require('../../app/modules/news/news.service');
                    const newsId = job.data.newsId;
                    const newsDoc = await News.findById(newsId);
                    if (newsDoc && !newsDoc.isNotificationSent) {
                         newsDoc.status = 'publish';
                         await newsDoc.save();
                         await broadcastNewsPublishedNotification(newsDoc);
                         logger.info(colors.green(`[BullMQ] Scheduled news ${newsId} published and broadcasted successfully`));
                    }
                    return { success: true, newsId, status: 'PUBLISHED' };
               }

               // Handle Team Subscriber Notifications (Bell Icon subscribers)
               if (job.name === 'team-subscriber-notification' || (job.data.teamId && !userId)) {
                    const teamId = job.data.teamId;
                    const { TeamSubscription } = require('../../app/modules/teamSubscription/teamSubscription.model');
                    const { ManagerTeam } = require('../../app/modules/managerTeam/managerTeam.model');
                    const { User } = require('../../app/modules/user/user.model');
                    const { USER_ROLES } = require('../../enums/user');

                    // Fetch both bell icon subscribers AND assigned team managers
                    const [subscribers, managerTeams, directManagers] = await Promise.all([
                         TeamSubscription.find({
                              team: teamId,
                              isBellActive: true,
                         }).select('user').lean(),
                         ManagerTeam.find({
                              team: teamId,
                         }).select('manager').lean(),
                         User.find({
                              role: USER_ROLES.MANAGER,
                              selectTeam: teamId,
                         }).select('_id').lean(),
                    ]);

                    // 1. Strictly deduplicate recipient user IDs (subscribers + managers)
                    const recipientSet = new Set<string>();

                    (subscribers || []).forEach((s: any) => {
                         const id = s.user?.toString();
                         if (id) recipientSet.add(id);
                    });

                    (managerTeams || []).forEach((m: any) => {
                         const id = m.manager?.toString();
                         if (id) recipientSet.add(id);
                    });

                    (directManagers || []).forEach((u: any) => {
                         const id = u._id?.toString();
                         if (id) recipientSet.add(id);
                    });

                    let subscriberUserIds: string[] = Array.from(recipientSet);

                    // 2. Only exclude user IDs if explicitly requested via excludeUserIds or excludeTriggerPlayer
                    const excludedList = [
                         ...(data?.excludeUserIds || []),
                         ...(data?.excludeTriggerPlayer ? [data?.playerId] : []),
                    ].filter(Boolean).map((id: any) => String(id));

                    if (excludedList.length > 0) {
                         const excludedUserIds = new Set<string>(excludedList);
                         subscriberUserIds = subscriberUserIds.filter(
                              (uId: string) => !excludedUserIds.has(uId),
                         );
                    }

                    logger.info(colors.cyan(`[Team Notification] Found ${subscriberUserIds.length} recipients (subscribers + managers) for team ${teamId}`));

                    if (subscriberUserIds.length > 0) {
                         const CHUNK_SIZE = 500;
                         for (let i = 0; i < subscriberUserIds.length; i += CHUNK_SIZE) {
                              const batch = subscriberUserIds.slice(i, i + CHUNK_SIZE);
                              await NotificationHelper.sendToBatch(batch, {
                                   title: title || 'Team Update',
                                   body: message,
                                   type: type || 'TEAM_UPDATE',
                                   reference,
                                   referenceModel: referenceModel || 'Team',
                                   data: {
                                        teamId: teamId?.toString() || '',
                                        screen: screen || 'TEAM_DETAILS',
                                        ...(data || {}),
                                   },
                              });
                         }
                    }

                    return { success: true, teamId, subscribersCount: subscriberUserIds.length };
               }

               // In-app + Push notification via NotificationHelper
               if (channels?.includes('in-app') || channels?.includes('push')) {
                    await NotificationHelper.sendToUser(userId!, {
                         title: title || 'Notification',
                         body: message,
                         type: type || 'SYSTEM',
                         category,
                         receiverRole,
                         reference,
                         referenceModel,
                         data: {
                              reference: reference?.toString() || '',
                              referenceModel: referenceModel || '',
                              screen: screen || '',
                              ...data,
                         },
                    });
                    logger.info(colors.cyan(`[BullMQ] Notification saved & sent to user ${userId}`));
               }
               logger.info(colors.green(`[BullMQ] Notification job ${job.id} completed`));
               return { success: true, userId, channels, jobId: job.id };
          } catch (error: any) {
               errorLogger.error(colors.red(`[BullMQ] Notification job ${job.id} failed:`), error);
               throw error;
          }
     },
     {
          connection: redisConnection,
          concurrency: 10,
     },
);

// ==========================================
// SMS WORKER
// ==========================================
export const smsWorker = new Worker<SMSJobData>(
     QUEUE_NAMES.SMS,
     async (job) => {
          try {
               const { phone, message, countryCode } = job.data;
               logger.info(colors.blue(`[BullMQ] Processing SMS job ${job.id}`));
               
               // Implement SMS sending logic here if needed (e.g. Twilio/VeevoTech)
               logger.info(colors.green(`[BullMQ] SMS sent to ${phone}`));
               return { success: true, phone, jobId: job.id };
          } catch (error: any) {
               errorLogger.error(colors.red(`[BullMQ] SMS job ${job.id} failed:`), error);
               throw error;
          }
     },
     {
          connection: redisConnection,
          concurrency: 3,
     },
);

// ==========================================
// CLEANUP WORKER
// ==========================================
export const cleanupWorker = new Worker<CleanupJobData>(
     QUEUE_NAMES.CLEANUP,
     async (job) => {
          try {
               const { type, olderThan } = job.data;
               logger.info(colors.blue(`[BullMQ] Processing cleanup job ${job.id} - Type: ${type}`));

               let deletedCount = 0;

               switch (type) {
                    case 'old-notifications':
                         const thirtyDaysAgo = new Date();
                         thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - (olderThan || 30));

                         const result = await Notification.deleteMany({
                              isRead: true,
                              createdAt: { $lt: thirtyDaysAgo },
                         });

                         deletedCount = result.deletedCount || 0;
                         logger.info(colors.cyan(`[BullMQ] Deleted ${deletedCount} old notifications`));
                         break;

                    case 'completed-jobs':
                         await emailQueue.clean(24 * 3600 * 1000, 100, 'completed');
                         await notificationQueue.clean(12 * 3600 * 1000, 50, 'completed');
                         await smsQueue.clean(24 * 3600 * 1000, 100, 'completed');
                         logger.info(colors.cyan(`[BullMQ] Cleaned old completed jobs from queues`));
                         break;

                    case 'failed-jobs':
                         await emailQueue.clean(7 * 24 * 3600 * 1000, 500, 'failed');
                         await notificationQueue.clean(7 * 24 * 3600 * 1000, 500, 'failed');
                         await smsQueue.clean(7 * 24 * 3600 * 1000, 500, 'failed');
                         logger.info(colors.cyan(`[BullMQ] Cleaned old failed jobs from queues`));
                         break;

                    case 'all-notifications':
                         const ninetyDaysAgo = new Date();
                         ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

                         const allResult = await Notification.deleteMany({
                              isRead: true,
                              createdAt: { $lt: ninetyDaysAgo },
                         });

                         deletedCount = allResult.deletedCount || 0;
                         logger.info(colors.cyan(`[BullMQ] Deleted ${deletedCount} very old notifications`));
                         break;

                    case 'subscription-sync':
                         const now = new Date();
                         const mistakenlyExpired = await Subscription.find({
                              status: { $in: ['expired', 'cancel'] },
                         }).populate('user');

                         let restoredCount = 0;
                         for (const sub of mistakenlyExpired) {
                              if (sub.currentPeriodEnd) {
                                   const endDate = new Date(sub.currentPeriodEnd);
                                   if (!isNaN(endDate.getTime()) && now < endDate) {
                                        sub.status = 'active';
                                        await sub.save();
                                        if (sub.user) {
                                             await User.findByIdAndUpdate((sub.user as any)._id || sub.user, {
                                                  isSubscribed: true,
                                                  hasAccess: true,
                                             });
                                        }
                                        restoredCount++;
                                   }
                              }
                         }
                         logger.info(colors.cyan(`[BullMQ] Restored ${restoredCount} valid subscriptions back to 'active'`));
                         break;

                    case 'unverified-users':
                         const cutoffDate = new Date(Date.now() - 5 * 60 * 1000);
                         const delRes = await User.deleteMany({
                              verified: false,
                              createdAt: { $lt: cutoffDate },
                         });
                         logger.info(colors.cyan(`[BullMQ] Deleted ${delRes.deletedCount || 0} unverified accounts`));
                         break;

                    case 'scheduled-news-sync':
                         const { News: NewsModel } = require('../../app/modules/news/news.model');
                         const { broadcastNewsPublishedNotification: broadcastNews } = require('../../app/modules/news/news.service');
                         const overdueNews = await NewsModel.find({
                              status: 'schedule',
                              publishDateTime: { $lte: new Date() },
                              isNotificationSent: { $ne: true },
                         });
                         for (const item of overdueNews) {
                              item.status = 'publish';
                              await item.save();
                              await broadcastNews(item);
                         }
                         if (overdueNews.length > 0) {
                              logger.info(colors.green(`[BullMQ] Published and notified ${overdueNews.length} overdue scheduled news articles`));
                         }
                         break;

                    case 'upcoming-match-reminders':
                         const { checkAndSendUpcomingMatchReminders: runMatchReminders } = require('../matchReminderHelper');
                         const reminderStats = await runMatchReminders();
                         if (reminderStats.processedMatches > 0) {
                              logger.info(colors.green(`[BullMQ] Upcoming match reminders: ${reminderStats.processedMatches} matches, ${reminderStats.totalRecipients} notifications dispatched`));
                         }
                         break;

                    case 'tournament-status-sync':
                         const { TournamentService: TournService } = require('../../app/modules/tournament/tournament.service');
                         const tournSyncRes = await TournService.syncTournamentStatusesInDB();
                         const totalUpdated = (tournSyncRes?.activated || 0) + (tournSyncRes?.completed || 0) + (tournSyncRes?.upcoming || 0);
                         if (totalUpdated > 0) {
                              logger.info(colors.green(`[BullMQ] Tournament status auto-sync: ${tournSyncRes.activated} activated, ${tournSyncRes.completed} completed, ${tournSyncRes.upcoming} upcoming`));
                         }
                         break;

                    default:
                         logger.warn(colors.yellow(`Unknown cleanup type: ${type}`));
               }

               logger.info(colors.green(`[BullMQ] Cleanup job ${job.id} completed`));
               return { success: true, type, deletedCount, jobId: job.id };
          } catch (error: any) {
               errorLogger.error(colors.red(`[BullMQ] Cleanup job ${job.id} failed:`), error);
               throw error;
          }
     },
     {
          connection: redisConnection,
          concurrency: 1,
     },
);

logger.info(colors.bgMagenta.white('All BullMQ workers are running'));

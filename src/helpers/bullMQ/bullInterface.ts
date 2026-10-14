export interface EmailJobData {
     to: string;
     subject: string;
     template?: string;
     data?: Record<string, any>;
     attachments?: Array<{
          filename: string;
          path?: string;
          content?: Buffer;
     }>;
}

export interface NotificationJobData {
     userId?: string; // undefined means all users
     title?: string;
     message: string;
     type?: string;
     channels?: Array<'push' | 'in-app' | 'socket'>;
     data?: any;
     reference?: string; // MongoDB ObjectId
     referenceModel?: string;
     screen?: 'DASHBOARD' | 'PAYMENT_HISTORY' | 'PROFILE';
     receiverRole?: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PLAYER' | 'TOURNAMENT_PLAYER';
     pushNotificationId?: string;
     targetRole?: string;
     category?: string;
     teamId?: string;
     newsId?: string;
}

export interface SMSJobData {
     phone: string;
     message: string;
     countryCode?: string;
}

export interface CleanupJobData {
     type: 'old-notifications' | 'completed-jobs' | 'failed-jobs' | 'all-notifications' | 'subscription-sync' | 'unverified-users' | 'scheduled-news-sync' | 'upcoming-match-reminders' | 'tournament-status-sync';
     olderThan?: number; // Days
}

export enum JobPriority {
     CRITICAL = 1,
     HIGH = 2,
     NORMAL = 3,
     LOW = 4,
     VERY_LOW = 5,
}

export interface QueueStats {
     name: string;
     waiting: number;
     active: number;
     completed: number;
     failed: number;
     delayed: number;
     paused: boolean;
     total: number;
}

export const QUEUE_NAMES = {
     EMAIL: 'eng-email-queue',
     NOTIFICATION: 'eng-notification-queue',
     SMS: 'eng-sms-queue',
     CLEANUP: 'eng-cleanup-queue',
} as const;

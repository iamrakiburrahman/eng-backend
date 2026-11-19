import colors from 'colors';
import { User } from '../app/modules/user/user.model';
import { PushNotification } from '../app/modules/pushNotification/pushNotification.model';
import config from '../config';
import { USER_ROLES } from '../enums/user';
import { logger } from '../shared/logger';

const superUser = {
    userName: 'Super Admin', // put client first name
    // lastName: 'Admin', // put client last name
    role: USER_ROLES.SUPER_ADMIN,
    email: config.admin.email,
    password: config.admin.password,
    verified: true,
};

const seedSuperAdmin = async () => {
    const isExistSuperAdmin = await User.findOne({
        role: USER_ROLES.SUPER_ADMIN,
    });

    if (!isExistSuperAdmin) {
        await User.create(superUser);
        logger.info(colors.green('Super admin created successfully!'));
    }

    // Seed a demo notification if none exists
    const isNotificationExist = await PushNotification.findOne();
    if (!isNotificationExist) {
        await PushNotification.create({
            title: "Welcome to ENG TV! ",
            message: "This is a demo broadcast notification sent to all users. Live streams and highlight updates will appear here.",
            user: null,
        });
        logger.info(colors.green('Demo push notification seeded successfully!'));
    }

    // Seed a demo in-app notification for the Admin to receive via NotificationHelper
    const adminUser = await User.findOne({ role: USER_ROLES.SUPER_ADMIN });
    if (adminUser) {
        // Dynamically import models to prevent circular dependency runtime ReferenceErrors
        const { Notification: InAppNotification } = await import('../app/modules/notification/notification.model');
        const { NotificationHelper } = await import('../app/builder/PushNotifications');
        const { NOTIFICATION_TYPE } = await import('../app/modules/notification/notification.interface');

        const isInAppExist = await InAppNotification.findOne({ receiver: adminUser._id });
        if (!isInAppExist) {
            await NotificationHelper.sendToUser(adminUser._id.toString(), {
                title: "System Status Alert ",
                body: "This is a demo system alert sent to your Admin account. Everything is running smoothly.",
                type: NOTIFICATION_TYPE.GENERAL,
            });
            logger.info(colors.green('Demo admin in-app notification seeded successfully!'));
        }
    }
};

export default seedSuperAdmin;
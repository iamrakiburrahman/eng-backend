import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiErrors';
import stripe from '../config/stripe';
import { User } from '../app/modules/user/user.model';
import { Subscription } from '../app/modules/subscription/subscription.model';
import { sendNotification } from '../helpers/notificationsHelper';
import { NOTIFICATION_TYPE } from '../app/modules/notification/notification.interface';

export const handleSubscriptionDeleted = async (data: any) => {
    // Retrieve the subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(data.id);

    // Find the current active subscription(s)
    const userSubscriptions = await Subscription.find({
        $or: [
            { subscriptionId: subscription.id },
            { customerId: subscription.customer },
        ],
        status: 'active',
    });

    if (userSubscriptions.length > 0) {
        // Cancel all matching subscriptions
        await Subscription.updateMany(
            {
                $or: [
                    { subscriptionId: subscription.id },
                    { customerId: subscription.customer },
                ],
                status: 'active',
            },
            { status: 'cancel' }
        );

        // Find the user associated with the subscription
        const userIds = [...new Set(userSubscriptions.map((s) => s.user?.toString()).filter(Boolean))];
        for (const userId of userIds) {
            const existingUser = await User.findById(userId);
            if (existingUser) {
                // Check if user still has another active subscription
                const hasOtherActive = await Subscription.exists({
                    user: existingUser._id,
                    status: 'active',
                });

                if (!hasOtherActive) {
                    await User.findByIdAndUpdate(
                        existingUser._id,
                        { hasAccess: false, isSubscribed: false },
                        { new: true },
                    );
                }

                // Send notification to User about subscription cancellation
                await sendNotification({
                    receiver: existingUser._id.toString(),
                    title: "Subscription Cancelled",
                    message: "Your subscription has been cancelled. You no longer have access to premium features.",
                    type: NOTIFICATION_TYPE.SUBSCRIPTION_CANCELLED,
                });
            }
        }
    } else {
        console.warn(`Subscription not found for cancellation: ${subscription.id}`);
    }
};
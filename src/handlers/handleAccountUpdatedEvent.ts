import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiErrors';
import stripe from '../config/stripe';
import { User } from '../app/modules/user/user.model';

export const handleAccountUpdatedEvent = async (data: { id: string; charges_enabled?: boolean }) => {

    // Find the user by Stripe account ID
    const existingUser = await User.findOne({ 'accountInformation.stripeAccountId': data.id });

    if (!existingUser) {
        console.warn(`User not found for Stripe account ID: ${data.id}`);
        return;
    }

    // Check if the onboarding is complete
    if (data.charges_enabled) {
        const loginLink = await stripe.accounts.createLoginLink(data.id);

        // Save Stripe account information to the user record
        await User.findByIdAndUpdate(existingUser._id, {
            accountInformation: {
                ...existingUser.accountInformation,
                status: true,
                externalAccountId: loginLink.url || data.id,
            }
        });
    }
}
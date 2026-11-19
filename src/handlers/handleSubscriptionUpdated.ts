import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiErrors';
import stripe from '../config/stripe';
import { User } from '../app/modules/user/user.model';
import { Subscription } from '../app/modules/subscription/subscription.model';
import { Package } from '../app/modules/package/package.model';
import { NOTIFICATION_TYPE } from '../app/modules/notification/notification.interface';
import { USER_ROLES } from '../enums/user';
import { NotificationQueueHelper } from '../helpers/bullMQ/bullHelper';
import { recordCoinTransaction } from '../helpers/coinLedgerHelper';
import { COIN_TRANSACTION_CATEGORY } from '../app/modules/coinTransaction/coinTransaction.interface';

export const handleSubscriptionUpdated = async (data: any) => {
  const subscription = await stripe.subscriptions.retrieve(data.id);

  const customer = (await stripe.customers.retrieve(
    subscription.customer as string
  )) as any;

  const priceId = subscription.items.data[0]?.price?.id;

  const invoice = subscription.latest_invoice
    ? await stripe.invoices.retrieve(subscription.latest_invoice as string)
    : null;

  const trxId = (invoice as any)?.payment_intent || subscription.id;
  const amountPaid = invoice?.total ? invoice.total / 100 : 0;

  const userId = subscription.metadata?.userId || customer?.metadata?.userId;
  let existingUser = null;
  if (userId) {
    existingUser = await User.findById(userId);
  }
  if (!existingUser && customer?.email) {
    existingUser = await User.findOne({ email: customer.email });
  }

  if (!existingUser) {
    console.warn(`handleSubscriptionUpdated: User not found for customer email ${customer?.email}`);
    return;
  }

  const pkg = await Package.findOne({ stripePriceId: priceId });
  if (!pkg) {
    console.error(`Package not found for priceId: ${priceId}`);
    return;
  }

  const currentPeriodStart = new Date(
    subscription.current_period_start * 1000
  ).toISOString();

  const currentPeriodEnd = new Date(
    subscription.current_period_end * 1000
  ).toISOString();

  // Find sub by subscriptionId or active user sub
  const existingSub = await Subscription.findOne({ subscriptionId: subscription.id });

  // Resolve target player
  const targetUserId =
    subscription.metadata?.targetUserId ||
    customer?.metadata?.targetUserId ||
    existingSub?.user ||
    userId;

  let targetUser = existingUser;
  if (targetUserId && targetUserId.toString() !== existingUser._id.toString()) {
    const foundTarget = await User.findById(targetUserId);
    if (foundTarget) {
      targetUser = foundTarget;
    }
  }

  const isPlayerRole =
    targetUser.role === USER_ROLES.PLAYER ||
    targetUser.role === USER_ROLES.TOURNAMENT_PLAYER ||
    targetUser.role === USER_ROLES.OTHER_CLUBS ||
    Boolean(targetUser.parentId);

  const creditToAdd = Number(pkg.credit) || 0;
  const marketValueToAdd = creditToAdd * 100;

  if (existingSub) {
    const isPackageChanged =
      existingSub.package &&
      existingSub.package.toString() !== pkg._id.toString();

    // Update existing subscription timestamps & status
    existingSub.currentPeriodStart = currentPeriodStart;
    existingSub.currentPeriodEnd = currentPeriodEnd;
    existingSub.status =
      subscription.status === 'active' ? 'active' : existingSub.status;
    if (trxId) existingSub.trxId = trxId;

    if (isPackageChanged) {
      existingSub.package = pkg._id;
      existingSub.price = amountPaid || pkg.price;
    }
    await existingSub.save();

    const updateData: any = {
      isSubscribed: subscription.status === 'active',
      hasAccess: subscription.status === 'active',
    };

    if (isPlayerRole && subscription.status === 'active') {
      updateData.blueTick = true;
    }

    await User.findByIdAndUpdate(targetUser._id, {
      $set: updateData,
    });

    // When package is updated/switched, add new package's coins and value to player through ledger
    if (isPackageChanged && subscription.status === 'active' && creditToAdd > 0) {
      try {
        await recordCoinTransaction({
          userId: targetUser._id,
          amount: creditToAdd,
          category: COIN_TRANSACTION_CATEGORY.SUBSCRIPTION_BONUS,
          title: "Subscription Bonus",
          description: `Credited ${creditToAdd.toLocaleString()} ENG Coins from "${pkg.title}" package update`,
          referenceId: subscription.id,
        });
      } catch (coinErr) {
        console.error("Error recording subscription coin transaction:", coinErr);
        const incData: any = { engCoine: creditToAdd };
        if (isPlayerRole) incData.marketValue = marketValueToAdd;
        await User.findByIdAndUpdate(targetUser._id, { $inc: incData });
      }
    }

    // Ensure Parent account also has active access
    if (existingUser._id.toString() !== targetUser._id.toString()) {
      await User.findByIdAndUpdate(existingUser._id, {
        $set: {
          isSubscribed: subscription.status === 'active',
          hasAccess: subscription.status === 'active',
        },
      });
    }

    if (isPackageChanged) {
      try {
        await NotificationQueueHelper.sendNotification(
          existingUser._id.toString(),
          `Your subscription has been updated to package "${pkg.title}".`,
          "Subscription Updated ",
          NOTIFICATION_TYPE.SUBSCRIPTION_ACTIVATED
        );
      } catch (err) {
        console.error("Failed to send subscription updated notification:", err);
      }
    }

    return existingSub;
  }

  // Handle case where user switches or creates new sub (existingSub not found)
  await Subscription.updateMany(
    { user: targetUser._id, status: 'active', subscriptionId: { $ne: subscription.id } },
    { status: 'cancel' }
  );

  const newSubscription = new Subscription({
    user: targetUser._id,
    customerId: customer?.id,
    package: pkg._id,
    price: amountPaid || pkg.price,
    status: 'active',
    trxId,
    subscriptionId: subscription.id,
    currentPeriodStart,
    currentPeriodEnd,
    remaining: 0,
  });

  await newSubscription.save();

  const updateData: any = {
    isSubscribed: true,
    hasAccess: true,
  };
  if (isPlayerRole) {
    updateData.blueTick = true;
  }
  await User.findByIdAndUpdate(targetUser._id, {
    $set: updateData,
  });

  if (creditToAdd > 0) {
    try {
      await recordCoinTransaction({
        userId: targetUser._id,
        amount: creditToAdd,
        category: COIN_TRANSACTION_CATEGORY.SUBSCRIPTION_BONUS,
        title: "Subscription Bonus",
        description: `Credited ${creditToAdd.toLocaleString()} ENG Coins from "${pkg.title}" package subscription`,
        referenceId: subscription.id,
      });
    } catch (coinErr) {
      console.error("Error recording subscription coin transaction:", coinErr);
      const incData: any = { engCoine: creditToAdd };
      if (isPlayerRole) incData.marketValue = marketValueToAdd;
      await User.findByIdAndUpdate(targetUser._id, { $inc: incData });
    }
  }

  // Ensure Parent account also has active access
  if (existingUser._id.toString() !== targetUser._id.toString()) {
    await User.findByIdAndUpdate(existingUser._id, {
      $set: { isSubscribed: true, hasAccess: true },
    });
  }

  try {
    await NotificationQueueHelper.sendNotification(
      existingUser._id.toString(),
      `Your subscription has been updated to package "${pkg.title}".`,
      "Subscription Updated ",
      NOTIFICATION_TYPE.SUBSCRIPTION_ACTIVATED
    );
  } catch (err) {
    console.error("Failed to send subscription updated notification:", err);
  }

  return newSubscription;
};
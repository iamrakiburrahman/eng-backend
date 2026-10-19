import ApiError from "../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import stripe from "../config/stripe";
import { User } from "../app/modules/user/user.model";
import { Package } from "../app/modules/package/package.model";
import { Subscription } from "../app/modules/subscription/subscription.model";
import { NOTIFICATION_TYPE } from "../app/modules/notification/notification.interface";
import { USER_ROLES } from "../enums/user";
import { NotificationQueueHelper } from "../helpers/bullMQ/bullHelper";
import { isPremiumPlayerPackage } from "../helpers/packageHelper";
import { recordCoinTransaction } from "../helpers/coinLedgerHelper";
import { COIN_TRANSACTION_CATEGORY } from "../app/modules/coinTransaction/coinTransaction.interface";

export const handleSubscriptionCreated = async (data: any) => {
  const subscription = await stripe.subscriptions.retrieve(data.id);

  const customer = (await stripe.customers.retrieve(
    subscription.customer as string
  )) as any;

  // 1. Idempotency check: if subscription already exists in DB, make sure user access is active
  const alreadyExists = await Subscription.findOne({
    subscriptionId: subscription.id,
  });

  if (alreadyExists) {
    if (alreadyExists.status === "active") {
      await User.findByIdAndUpdate(alreadyExists.user, { isSubscribed: true, hasAccess: true });
      await Subscription.updateMany(
        { user: alreadyExists.user, status: "active", _id: { $ne: alreadyExists._id } },
        { status: "cancel" }
      );
    }
    return alreadyExists;
  }

  // 2. Find user by email or metadata.userId
  const userId = subscription.metadata?.userId || customer?.metadata?.userId;
  let user = null;
  if (userId) {
    user = await User.findById(userId);
  }
  if (!user && customer?.email) {
    user = await User.findOne({ email: customer.email });
  }

  if (!user) {
    console.warn(`⚠️ handleSubscriptionCreated: User not found for customer email "${customer?.email}". Will rely on checkout.session.completed event for activation.`);
    return;
  }

  const priceId = subscription.items.data[0]?.price?.id;

  const invoice = subscription.latest_invoice
    ? await stripe.invoices.retrieve(subscription.latest_invoice as string)
    : null;

  const trxId = (invoice as any)?.payment_intent || subscription.id;

  const currentPeriodStart = new Date(
    subscription.current_period_start * 1000
  ).toISOString();

  const currentPeriodEnd = new Date(
    subscription.current_period_end * 1000
  ).toISOString();

  const pkg = await Package.findOne({
    stripePriceId: priceId
  });

  if (!pkg) {
    console.error("❌ Package not found for priceId:", priceId);
    throw new ApiError(StatusCodes.NOT_FOUND, "Package not found");
  }

  const targetUserId = subscription.metadata?.targetUserId || customer?.metadata?.targetUserId || userId;
  let targetUser = user;
  if (targetUserId && targetUserId.toString() !== user._id.toString()) {
    const foundTarget = await User.findById(targetUserId);
    if (foundTarget) {
      targetUser = foundTarget;
    }
  }

  // Cancel any old active subscriptions for THIS specific target player (do not cancel parent or other children)
  await Subscription.updateMany(
    { user: targetUser._id, status: "active", subscriptionId: { $ne: subscription.id } },
    { status: "cancel" }
  );

  let newSub;
  try {
    newSub = await Subscription.create({
      customerId: customer.id,
      price: subscription.items.data[0]?.price?.unit_amount
        ? subscription.items.data[0].price.unit_amount / 100
        : pkg.price,
      user: targetUser._id,
      package: pkg._id,
      trxId,
      subscriptionId: subscription.id,
      currentPeriodStart,
      currentPeriodEnd,
      remaining: 0,
      status: "active",
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      newSub = await Subscription.findOne({ subscriptionId: subscription.id });
    } else {
      throw err;
    }
  }

  const isPremium = await isPremiumPlayerPackage(pkg);

  const creditToAdd = isPremium ? (Number(pkg.credit) || 0) : 0;
  const marketValueToAdd = isPremium ? (creditToAdd * 100) : 0;

  const updateData: any = {
    isSubscribed: true,
    hasAccess: true,
  };

  if (
    targetUser.role === USER_ROLES.PLAYER ||
    targetUser.role === USER_ROLES.TOURNAMENT_PLAYER ||
    targetUser.role === USER_ROLES.OTHER_CLUBS ||
    targetUser.parentId
  ) {
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
        description: `Credited ${creditToAdd.toLocaleString()} ENG Coins from "${pkg.title}" package upgrade`,
        referenceId: subscription.id,
      });
    } catch (coinErr) {
      console.error("Error recording subscription coin transaction:", coinErr);
      await User.findByIdAndUpdate(targetUser._id, {
        $inc: { engCoine: creditToAdd, marketValue: marketValueToAdd },
      });
    }
  }

  if (user._id.toString() !== targetUser._id.toString()) {
    await User.findByIdAndUpdate(user._id, {
      $set: { isSubscribed: true, hasAccess: true },
    });
  }

  // 🔔 Queue push + in-app notification
  try {
    await NotificationQueueHelper.sendNotification(
      user._id.toString(),
      `Your subscription for package "${pkg.title}" is now active. Enjoy all premium features!`,
      "Subscription Activated! 🚀",
      NOTIFICATION_TYPE.SUBSCRIPTION_ACTIVATED
    );
  } catch (err) {
    console.error("Failed to send subscription notification:", err);
  }

  return newSub;
};
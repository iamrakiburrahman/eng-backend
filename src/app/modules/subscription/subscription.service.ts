import { JwtPayload } from "jsonwebtoken";
import { Package } from "../package/package.model";
import { ISubscription } from "./subscription.interface";
import { Subscription } from "./subscription.model";
import ApiError from "../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import { USER_ROLES } from "../../../enums/user";


const subscriptionDetailsFromDB = async (user: JwtPayload): Promise<{ subscription: ISubscription | {} }> => {
    const subscription = await Subscription.findOne({ user: user.id, status: "active" })
        .sort({ createdAt: -1 })
        .populate("package", "title credit")
        .lean();

    if (!subscription) {
        return { subscription: {} }; // Return empty object if no active subscription found
    }

    return { subscription };
};

const companySubscriptionDetailsFromDB = async (
    id: string,
    user?: JwtPayload | null
): Promise<{ subscription: ISubscription | {} }> => {
    if (user && user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPER_ADMIN) {
        const requesterId = (user.id || user._id)?.toString();
        if (requesterId !== id.toString()) {
            throw new ApiError(
                StatusCodes.FORBIDDEN,
                "You are not authorized to view subscription details of other accounts."
            );
        }
    }

    const subscription = await Subscription.findOne({ user: id, status: "active" })
        .sort({ createdAt: -1 })
        .populate("package", "title credit")
        .lean();

    if (!subscription) {
        return { subscription: {} }; // Return empty object if no active subscription found
    }

    return { subscription };
};



const subscriptionsFromDB = async (query: Record<string, unknown>): Promise<ISubscription[]> => {
    const anyConditions: any[] = [];

    const { search, limit, page, paymentType } = query;

    if (search) {
        const matchingPackageIds = await Package.find({
            $or: [
                { title: { $regex: search, $options: "i" } },
                { paymentType: { $regex: search, $options: "i" } },
            ]
        } as any).distinct("_id");
    
        if (matchingPackageIds.length) {
            anyConditions.push({
                package: { $in: matchingPackageIds }
            });
        }
    }
    
    

    if (paymentType) {
        anyConditions.push({
            package: { $in: await Package.find({paymentType: paymentType}).distinct("_id")  }
        })
    }

    const whereConditions = anyConditions.length > 0 ? { $and: anyConditions } : {};
    const pages = parseInt(page as string) || 1;
    const size = parseInt(limit as string) || 10;
    const skip = (pages - 1) * size;

    const result = await Subscription.find(whereConditions).populate([
        {
            path: "package",
            select: "title paymentType credit description"
        },
        {
            path: "user",
            select: "email name linkedIn contact company website "
        },
    ])
        .select("user package price trxId currentPeriodStart currentPeriodEnd status")
        .skip(skip)
        .limit(size);

    const count = await Subscription.countDocuments(whereConditions);
    
    const data: any = {
        data: result,
        meta: {
            page: pages,
            total: count
        }
    }

    return data;
}

export const SubscriptionService = {
    subscriptionDetailsFromDB,
    subscriptionsFromDB,
    companySubscriptionDetailsFromDB
}
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import QueryBuilder from '../../../util/queryBuilder';
import { ISponsorship } from './sponsorship.interface';
import { Sponsorship } from './sponsorship.model';

const createSponsorshipToDB = async (
  payload: Partial<ISponsorship>,
  userId?: string
): Promise<ISponsorship> => {
  if (!payload.name) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Brand/Sponsor name is required');
  }

  if (!payload.logo) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Brand/Sponsor logo image is required');
  }

  // If order is not explicitly provided, assign the next available order index
  if (payload.order === undefined || payload.order === null) {
    const highestOrderDoc = await Sponsorship.findOne()
      .sort({ order: -1 })
      .select('order')
      .lean();
    payload.order = (highestOrderDoc?.order ?? -1) + 1;
  }

  // Standardize placements
  if (!payload.placements || payload.placements.length === 0) {
    payload.placements = ['home', 'all'];
  }

  const result = await Sponsorship.create({
    ...payload,
    createdBy: userId,
  });

  return result;
};

const getAllSponsorshipsForAdminFromDB = async (query: Record<string, any>) => {
  const queryObj = { ...query };

  const sponsorshipQuery = new QueryBuilder(
    Sponsorship.find().populate('createdBy', 'firstName lastName email profile'),
    queryObj
  )
    .search(['name', 'title', 'description', 'websiteUrl', 'tier', 'type'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await sponsorshipQuery.modelQuery;
  const meta = await sponsorshipQuery.getPaginationInfo();

  return {
    meta,
    result,
  };
};

const getShowcaseSponsorshipsForClientFromDB = async (
  query: Record<string, any>
) => {
  const now = new Date();

  const filter: Record<string, any> = {
    status: 'active',
    $and: [
      {
        $or: [{ startDate: null }, { startDate: { $exists: false } }, { startDate: { $lte: now } }],
      },
      {
        $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: now } }],
      },
    ],
  };

  // Filter by placement (e.g. 'home', 'tournament', 'match', 'footer')
  if (query.placement && query.placement !== 'all') {
    filter.placements = { $in: [query.placement, 'all'] };
  }

  // Filter by type (sponsor, partner, brand_collaboration)
  if (query.type) {
    filter.type = query.type;
  }

  // Filter by tier (title, platinum, gold, official, etc.)
  if (query.tier) {
    filter.tier = query.tier;
  }

  const sponsors = await Sponsorship.find(filter)
    .sort({ order: 1, createdAt: -1 })
    .lean();

  // Atomically increment impressionCount for active items in the background
  if (sponsors.length > 0) {
    const sponsorIds = sponsors.map((s) => s._id);
    Sponsorship.updateMany(
      { _id: { $in: sponsorIds } },
      { $inc: { impressionCount: 1 } }
    ).catch(() => {});
  }

  // Group by Tier for structured mobile/web rendering
  const byTier: Record<string, any[]> = {};
  const byType: Record<string, any[]> = {
    sponsor: [],
    partner: [],
    brand_collaboration: [],
  };

  for (const s of sponsors) {
    // Group by Tier
    const tier = s.tier || 'official';
    if (!byTier[tier]) {
      byTier[tier] = [];
    }
    byTier[tier].push(s);

    // Group by Type
    const type = s.type || 'sponsor';
    if (!byType[type]) {
      byType[type] = [];
    }
    byType[type].push(s);
  }

  return {
    total: sponsors.length,
    sponsors,
    byTier,
    byType,
  };
};

const getSingleSponsorshipFromDB = async (
  id: string,
  incrementImpression = false
): Promise<ISponsorship | null> => {
  const query = Sponsorship.findById(id).populate(
    'createdBy',
    'firstName lastName email profile'
  );

  const result = await query;
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Sponsorship/Partner not found');
  }

  if (incrementImpression) {
    Sponsorship.findByIdAndUpdate(id, { $inc: { impressionCount: 1 } }).catch(() => {});
  }

  return result;
};

const updateSponsorshipInDB = async (
  id: string,
  payload: Partial<ISponsorship>
): Promise<ISponsorship | null> => {
  const isExist = await Sponsorship.findById(id);
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Sponsorship/Partner not found');
  }

  const result = await Sponsorship.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });

  return result;
};

const deleteSponsorshipFromDB = async (
  id: string
): Promise<ISponsorship | null> => {
  const isExist = await Sponsorship.findById(id);
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Sponsorship/Partner not found');
  }

  const result = await Sponsorship.findByIdAndDelete(id);
  return result;
};

const toggleSponsorshipStatusInDB = async (
  id: string
): Promise<ISponsorship | null> => {
  const isExist = await Sponsorship.findById(id);
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Sponsorship/Partner not found');
  }

  const newStatus = isExist.status === 'active' ? 'inactive' : 'active';
  isExist.status = newStatus;
  await isExist.save();

  return isExist;
};

const recordSponsorshipClickInDB = async (id: string) => {
  const sponsor = await Sponsorship.findByIdAndUpdate(
    id,
    { $inc: { clickCount: 1 } },
    { new: true }
  );

  if (!sponsor) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Sponsorship/Partner not found');
  }

  return {
    id: sponsor._id,
    name: sponsor.name,
    websiteUrl: sponsor.websiteUrl,
    clickCount: sponsor.clickCount,
  };
};

const rearrangeSponsorshipOrderInDB = async (
  items: { id: string; order: number }[]
) => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Invalid items list for reordering'
    );
  }

  const bulkOps = items.map((item) => ({
    updateOne: {
      filter: { _id: item.id },
      update: { $set: { order: Number(item.order) } },
    },
  }));

  const result = await Sponsorship.bulkWrite(bulkOps);

  return {
    modifiedCount: result.modifiedCount,
    success: true,
  };
};

const getSponsorshipAnalyticsFromDB = async () => {
  const [
    total,
    active,
    inactive,
    aggregates,
    byTypeAgg,
    byTierAgg,
    topClicked,
  ] = await Promise.all([
    Sponsorship.countDocuments(),
    Sponsorship.countDocuments({ status: 'active' }),
    Sponsorship.countDocuments({ status: 'inactive' }),
    Sponsorship.aggregate([
      {
        $group: {
          _id: null,
          totalClicks: { $sum: '$clickCount' },
          totalImpressions: { $sum: '$impressionCount' },
        },
      },
    ]),
    Sponsorship.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
        },
      },
    ]),
    Sponsorship.aggregate([
      {
        $group: {
          _id: '$tier',
          count: { $sum: 1 },
        },
      },
    ]),
    Sponsorship.find({ status: 'active' })
      .sort({ clickCount: -1 })
      .limit(5)
      .select('name title logo type tier clickCount impressionCount websiteUrl')
      .lean(),
  ]);

  const totalClicks = aggregates[0]?.totalClicks || 0;
  const totalImpressions = aggregates[0]?.totalImpressions || 0;
  const clickThroughRate =
    totalImpressions > 0
      ? Number(((totalClicks / totalImpressions) * 100).toFixed(2))
      : 0;

  const byType: Record<string, number> = {
    sponsor: 0,
    partner: 0,
    brand_collaboration: 0,
  };
  byTypeAgg.forEach((item) => {
    if (item._id) byType[item._id] = item.count;
  });

  const byTier: Record<string, number> = {};
  byTierAgg.forEach((item) => {
    if (item._id) byTier[item._id] = item.count;
  });

  return {
    overview: {
      total,
      active,
      inactive,
      totalClicks,
      totalImpressions,
      clickThroughRate: `${clickThroughRate}%`,
    },
    byType,
    byTier,
    topClickedSponsors: topClicked,
  };
};

export const SponsorshipService = {
  createSponsorshipToDB,
  getAllSponsorshipsForAdminFromDB,
  getShowcaseSponsorshipsForClientFromDB,
  getSingleSponsorshipFromDB,
  updateSponsorshipInDB,
  deleteSponsorshipFromDB,
  toggleSponsorshipStatusInDB,
  recordSponsorshipClickInDB,
  rearrangeSponsorshipOrderInDB,
  getSponsorshipAnalyticsFromDB,
};

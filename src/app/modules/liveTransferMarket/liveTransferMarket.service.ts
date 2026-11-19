import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import ApiError from '../../../errors/ApiErrors';
import { USER_ROLES } from '../../../enums/user';
import { User } from '../user/user.model';
import { Team } from '../team/team.model';
import { ManagerTeam } from '../managerTeam/managerTeam.model';
import { Transfer } from '../transfer/transfer.model';
import { LiveTransferMarket } from './liveTransferMarket.model';
import { NotificationQueueHelper } from '../../../helpers/bullMQ/bullHelper';
import { sendNotificationToAdmins } from '../../../helpers/notificationsHelper';
import { NOTIFICATION_TYPE } from '../notification/notification.interface';
import { ClubEconomy } from '../coinAndBudget/clubEconomySchema.model';
import { PlayerEconomy } from '../coinAndBudget/playerEconomySchema.model';

// Helper: Resolve player id whether caller is player, parent, or admin
const resolveTargetPlayerId = async (
  userId: string,
  userRole: string,
  requestedPlayerId?: string
): Promise<string> => {
  const userStrId = userId.toString();
  const userObjId = mongoose.Types.ObjectId.isValid(userStrId)
    ? new mongoose.Types.ObjectId(userStrId)
    : null;

  if (requestedPlayerId) {
    if (userRole === USER_ROLES.ADMIN || userRole === USER_ROLES.SUPER_ADMIN) {
      return requestedPlayerId;
    }
    // Check if requested player belongs to caller as parent
    const child = await User.findOne({
      _id: requestedPlayerId,
      $or: [
        { parentId: userStrId },
        ...(userObjId ? [{ parentId: userObjId }] : []),
      ],
    });
    if (child) {
      return child._id.toString();
    }
    if (userId.toString() === requestedPlayerId.toString()) {
      return requestedPlayerId;
    }
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'You are not authorized to manage this player.'
    );
  }

  // If no playerId passed, check if caller is a parent with child player
  const child = await User.findOne({
    $or: [
      { parentId: userStrId },
      ...(userObjId ? [{ parentId: userObjId }] : []),
    ],
  });
  if (child) {
    return child._id.toString();
  }

  return userId;
};

// 1. JOIN LIVE TRANSFER MARKET (PLAYER / PARENT)
const joinMarketToDB = async (
  userId: string,
  userRole: string,
  payload: any
) => {
  const targetPlayerId = await resolveTargetPlayerId(
    userId,
    userRole,
    payload?.playerId
  );

  const player = await User.findById(targetPlayerId);
  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Player not found');
  }

  if (!player.selectTeam) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Only players currently registered with a club can join the Live Transfer Market. Free agents can be onboarded directly.'
    );
  }

  // Check if player already has an active listing
  const activeListing = await LiveTransferMarket.findOne({
    player: targetPlayerId,
    status: { $in: ['ACTIVE', 'PENDING_TRANSFER'] },
  });

  if (activeListing) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Player is already actively listed on the Live Transfer Market.'
    );
  }

  // Find current manager of player's team
  const managerTeam = await ManagerTeam.findOne({ team: player.selectTeam });
  const currentManager = managerTeam ? managerTeam.manager : null;

  const listing = await LiveTransferMarket.create({
    player: targetPlayerId,
    currentTeam: player.selectTeam,
    currentManager,
    preferredPositions: Array.isArray(payload.preferredPositions)
      ? payload.preferredPositions
      : player.position
      ? [player.position]
      : [],
    notes: payload.notes || null,
    status: 'ACTIVE',
    listedAt: new Date(),
  });

  player.isLiveTransferListed = true;
  player.liveTransferListingId = listing._id as any;
  await player.save();

  const playerName = `${player.firstName || ''} ${
    player.lastName || player.userName || 'Player'
  }`.trim();

  // Notify player
  await NotificationQueueHelper.sendNotification(
    targetPlayerId,
    'You have successfully joined the Live Transfer Market. Clubs can now view your profile and submit transfer bids.',
    'Joined Live Transfer Market',
    NOTIFICATION_TYPE.GENERAL,
    USER_ROLES.PLAYER,
    listing._id.toString(),
    'LiveTransferMarket'
  );

  // Notify parent
  if (player.parentId) {
    await NotificationQueueHelper.sendNotification(
      player.parentId.toString(),
      `${playerName} has joined the Live Transfer Market.`,
      'Player Listed on Live Transfer Market',
      NOTIFICATION_TYPE.GENERAL,
      undefined,
      listing._id.toString(),
      'LiveTransferMarket'
    );
  }

  // Notify current manager
  if (currentManager) {
    await NotificationQueueHelper.sendNotification(
      currentManager.toString(),
      `Your player ${playerName} has listed themselves on the Live Transfer Market.`,
      'Player Listed on Transfer Market',
      NOTIFICATION_TYPE.GENERAL,
      USER_ROLES.MANAGER,
      listing._id.toString(),
      'LiveTransferMarket'
    );
  }

  return await LiveTransferMarket.findById(listing._id)
    .populate('player', 'firstName lastName userName email profile position engCoine marketValue dateOfBirth')
    .populate('currentTeam', 'teamName logo clubCode');
};

// 2. LEAVE LIVE TRANSFER MARKET (PLAYER / PARENT)
const leaveMarketToDB = async (
  userId: string,
  userRole: string,
  playerId?: string
) => {
  const targetPlayerId = await resolveTargetPlayerId(
    userId,
    userRole,
    playerId
  );

  const listing = await LiveTransferMarket.findOne({
    player: targetPlayerId,
    status: { $in: ['ACTIVE', 'PENDING_TRANSFER'] },
  });

  if (!listing) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'No active Live Transfer Market listing found for this player.'
    );
  }

  // Check if any transfer is currently waiting for Admin final approval
  const inReviewTransfer = await Transfer.findOne({
    player: targetPlayerId,
    isLiveMarket: true,
    status: { $in: ['BOTH_APPROVED', 'MANAGER_APPROVED'] },
    'playerApproval.status': 'APPROVED',
    'managerApproval.status': 'APPROVED',
  });

  if (inReviewTransfer) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Cannot delist: A transfer request has been approved by both parties and is currently awaiting final Admin approval.'
    );
  }

  // Cancel any pending transfer bids for this player
  await Transfer.updateMany(
    {
      player: targetPlayerId,
      isLiveMarket: true,
      status: 'PENDING',
    },
    {
      status: 'WITHDRAWN',
      rejectReason: 'Player withdrew from the Live Transfer Market.',
    }
  );

  listing.status = 'DELISTED';
  listing.delistedAt = new Date();
  await listing.save();

  await User.findByIdAndUpdate(targetPlayerId, {
    isLiveTransferListed: false,
    liveTransferListingId: null,
  });

  return { message: 'Successfully removed from the Live Transfer Market.' };
};

// 3. GET MY LISTING STATUS (PLAYER / PARENT)
const getMyListingFromDB = async (userId: string, userRole: string, playerId?: string) => {
  const targetPlayerId = await resolveTargetPlayerId(
    userId,
    userRole,
    playerId
  );

  const listing = await LiveTransferMarket.findOne({
    player: targetPlayerId,
    status: { $in: ['ACTIVE', 'PENDING_TRANSFER'] },
  })
    .populate('player', 'firstName lastName userName email profile position engCoine marketValue dateOfBirth selectTeam')
    .populate('currentTeam', 'teamName logo clubCode');

  const incomingOffersCount = await Transfer.countDocuments({
    player: targetPlayerId,
    isLiveMarket: true,
    status: { $in: ['PENDING', 'MANAGER_APPROVED', 'BOTH_APPROVED'] },
  });

  return {
    isListed: !!listing,
    listing: listing || null,
    incomingOffersCount,
  };
};

// 4. BROWSE PLAYERS ON LIVE TRANSFER MARKET (MANAGERS / ADMINS)
const getLiveMarketPlayersFromDB = async (
  query: Record<string, any>,
  user: any
) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const matchFilter: any = {
    status: 'ACTIVE',
  };

  // If requesting user is a manager, exclude players belonging to their own team
  let managerTeamId: any = null;
  if (user?.role === USER_ROLES.MANAGER) {
    const managerTeam = await ManagerTeam.findOne({ manager: user._id || user.id });
    if (managerTeam) {
      managerTeamId = managerTeam.team;
      matchFilter.currentTeam = { $ne: managerTeamId };
    }
  }

  if (query.teamId) {
    matchFilter.currentTeam = new mongoose.Types.ObjectId(query.teamId);
  }

  // Search by player name or email
  const searchTerm = (query.searchTerm || query.search) as string;
  let playerMatch: any = {};
  if (searchTerm && searchTerm.trim()) {
    const regex = new RegExp(searchTerm.trim(), 'i');
    playerMatch.$or = [
      { firstName: regex },
      { lastName: regex },
      { userName: regex },
      { email: regex },
    ];
  }

  if (query.position) {
    playerMatch.position = query.position;
  }

  const [listings, total] = await Promise.all([
    LiveTransferMarket.find(matchFilter)
      .sort({ listedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'player',
        match: Object.keys(playerMatch).length > 0 ? playerMatch : undefined,
        select:
          'firstName lastName userName email profile position engCoine marketValue dateOfBirth height weight strongFoot selectTeam',
      })
      .populate('currentTeam', 'teamName logo clubCode')
      .populate('currentManager', 'firstName lastName profile email'),
    LiveTransferMarket.countDocuments(matchFilter),
  ]);

  // Filter out any where player did not match playerMatch
  const filteredListings = listings.filter((l) => l.player !== null);

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: filteredListings,
  };
};

// 5. SUBMIT TRANSFER BID FOR A LIVE MARKET PLAYER (BUYING MANAGER)
const requestLiveTransferToDB = async (userId: string, payload: any) => {
  const { player: playerId, toTeam, note } = payload;

  const player = await User.findById(playerId);
  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Player not found');
  }

  const fromTeam = player.selectTeam;
  if (!fromTeam) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Player does not belong to any team.'
    );
  }

  // Check if player has an active Live Transfer Market listing
  const listing = await LiveTransferMarket.findOne({
    player: playerId,
    status: 'ACTIVE',
  });

  if (!listing) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This player is not currently actively listed on the Live Transfer Market.'
    );
  }

  // Cannot bid on own team's player
  if (fromTeam.toString() === toTeam.toString()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You cannot send a transfer request for a player who is already in your team.'
    );
  }

  // Manager must be assigned to the buying team
  const isManager = await ManagerTeam.findOne({
    manager: userId,
    team: toTeam,
  });

  if (!isManager) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Access Denied: You are not a manager of the target buying club.'
    );
  }

  // Check duplicate pending transfer request
  const existingPending = await Transfer.findOne({
    player: playerId,
    toTeam,
    status: { $in: ['PENDING', 'MANAGER_APPROVED', 'BOTH_APPROVED'] },
  });

  if (existingPending) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'A pending transfer request already exists for this player from your club.'
    );
  }

  // Economy check: ensure buying team has sufficient coin balance
  const [clubEconomy, playerEconomy] = await Promise.all([
    ClubEconomy.findOne(),
    PlayerEconomy.findOne(),
  ]);

  const conversionRate = Number(playerEconomy?.conversionRate) || 10;
  const minReserveCoins =
    typeof clubEconomy?.minReserveCoins === 'number'
      ? clubEconomy.minReserveCoins
      : clubEconomy?.startingBudget || 100000;

  const playerCost =
    player.engCoine !== undefined && player.engCoine !== null
      ? player.engCoine
      : Math.round((player.marketValue || 0) / conversionRate);

  const toTeamData = await Team.findById(toTeam);
  if (!toTeamData) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Target buying team not found.');
  }

  const buyingTeamCoin = toTeamData.coin || 0;
  if (playerCost > 0 && buyingTeamCoin - playerCost < minReserveCoins) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Insufficient club coin balance! Your team has ${buyingTeamCoin.toLocaleString()} coins. A minimum balance of ${minReserveCoins.toLocaleString()} coins must be maintained after transferring (Player cost: ${playerCost.toLocaleString()} coins).`
    );
  }

  // Create transfer record with two-party approval structure
  const transfer = await Transfer.create({
    player: playerId,
    fromTeam,
    toTeam,
    requestedBy: userId,
    transferType: 'CLUB_TO_CLUB',
    isLiveMarket: true,
    liveMarketListing: listing._id,
    status: 'PENDING',
    playerApproval: {
      status: 'PENDING',
      respondedAt: null,
      rejectReason: null,
      respondedBy: null,
    },
    managerApproval: {
      status: 'PENDING',
      respondedAt: null,
      rejectReason: null,
      respondedBy: null,
    },
    note: note || null,
  });

  const playerName = `${player.firstName || ''} ${
    player.lastName || player.userName || 'Player'
  }`.trim();
  const buyingTeamName = toTeamData.teamName || 'New Club';

  // 1. Notify Player
  await NotificationQueueHelper.sendNotification(
    playerId.toString(),
    `${buyingTeamName} has submitted a transfer bid for you on the Live Transfer Market. Please review and respond.`,
    'New Transfer Bid Received',
    NOTIFICATION_TYPE.TRANSFER_REQUESTED,
    USER_ROLES.PLAYER,
    transfer._id.toString(),
    'Transfer'
  );

  // 2. Notify Parent (if minor player)
  if (player.parentId) {
    await NotificationQueueHelper.sendNotification(
      player.parentId.toString(),
      `${buyingTeamName} has placed a transfer bid for your child ${playerName} on the Live Transfer Market.`,
      'Transfer Bid for Your Child',
      NOTIFICATION_TYPE.TRANSFER_REQUESTED,
      undefined,
      transfer._id.toString(),
      'Transfer'
    );
  }

  // 3. Notify Selling Club Managers
  const sellingManagers = await ManagerTeam.find({ team: fromTeam });
  for (const sm of sellingManagers) {
    await NotificationQueueHelper.sendNotification(
      sm.manager.toString(),
      `${buyingTeamName} has submitted a transfer bid for your player ${playerName} via the Live Transfer Market. Please review.`,
      'Transfer Bid Received for Player',
      NOTIFICATION_TYPE.TRANSFER_REQUESTED,
      USER_ROLES.MANAGER,
      transfer._id.toString(),
      'Transfer'
    );
  }

  // 4. Notify Requesting Manager
  await NotificationQueueHelper.sendNotification(
    userId,
    `Your transfer bid for ${playerName} has been submitted successfully and is awaiting review by both the player and the current club manager.`,
    'Transfer Bid Submitted',
    NOTIFICATION_TYPE.TRANSFER_REQUESTED,
    USER_ROLES.MANAGER,
    transfer._id.toString(),
    'Transfer'
  );

  return transfer;
};

// 6. PLAYER / PARENT CONSENT RESPONSE (APPROVE / REJECT)
const respondByPlayerToDB = async (
  transferId: string,
  userId: string,
  payload: { action: 'APPROVE' | 'REJECT'; reason?: string }
) => {
  const transfer = await Transfer.findById(transferId);
  if (!transfer) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Transfer request not found.');
  }

  if (!transfer.isLiveMarket) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This endpoint is only for Live Transfer Market requests.'
    );
  }

  const player = await User.findById(transfer.player);
  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Player not found.');
  }

  // Verify that caller is either the player themselves or the parent
  const isDirectPlayer = transfer.player.toString() === userId.toString();
  const isParent = player.parentId && player.parentId.toString() === userId.toString();

  if (!isDirectPlayer && !isParent) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Access Denied: Only the player or their registered parent can respond to this transfer request.'
    );
  }

  if (transfer.status === 'APPROVED') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This transfer is already completed.');
  }

  if (transfer.status === 'REJECTED' || transfer.status === 'WITHDRAWN') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This transfer request has already been closed or rejected.'
    );
  }

  const playerName = `${player.firstName || ''} ${
    player.lastName || player.userName || 'Player'
  }`.trim();
  const toTeamObj = await Team.findById(transfer.toTeam);
  const toTeamName = toTeamObj?.teamName || 'New Club';

  if (payload.action === 'REJECT') {
    transfer.playerApproval = {
      status: 'REJECTED',
      respondedAt: new Date(),
      rejectReason: payload.reason || 'Declined by player/parent',
      respondedBy: new mongoose.Types.ObjectId(userId) as any,
    };
    transfer.status = 'REJECTED';
    transfer.rejectReason = payload.reason || 'Declined by player/parent';
    await transfer.save();

    // Notify buying manager
    await NotificationQueueHelper.sendNotification(
      transfer.requestedBy.toString(),
      `${playerName} has declined your transfer bid to join ${toTeamName}.`,
      'Transfer Bid Declined',
      NOTIFICATION_TYPE.TRANSFER_REJECTED,
      USER_ROLES.MANAGER,
      transfer._id.toString(),
      'Transfer'
    );

    return {
      message: 'Transfer offer rejected. Player remains in current club.',
      transfer,
    };
  }

  // Action: APPROVE
  transfer.playerApproval = {
    status: 'APPROVED',
    respondedAt: new Date(),
    rejectReason: null,
    respondedBy: new mongoose.Types.ObjectId(userId) as any,
  };

  // Check if current manager has also approved
  const isManagerApproved = transfer.managerApproval?.status === 'APPROVED';

  if (isManagerApproved) {
    // BOTH PARTIES HAVE APPROVED -> READY FOR ADMIN FINAL APPROVAL
    transfer.status = 'BOTH_APPROVED';
    await transfer.save();

    // Notify Admin
    await sendNotificationToAdmins({
      title: 'Live Transfer Approved by Both Parties',
      message: `Transfer for ${playerName} to ${toTeamName} has been approved by BOTH the player and current club manager. Final Admin approval is required.`,
      type: NOTIFICATION_TYPE.TRANSFER_REQUESTED,
      metadata: { transferId: transfer._id, isLiveMarket: true },
    });

    // Notify buying manager
    await NotificationQueueHelper.sendNotification(
      transfer.requestedBy.toString(),
      `Great news! Both ${playerName} and their current club manager have accepted your transfer bid. The transfer is now awaiting final Admin approval.`,
      'Transfer Bid Accepted by Both Parties',
      NOTIFICATION_TYPE.GENERAL,
      USER_ROLES.MANAGER,
      transfer._id.toString(),
      'Transfer'
    );
  } else {
    // Player approved, but manager is still pending
    await transfer.save();

    // Notify selling manager that player agreed
    if (transfer.fromTeam) {
      const sellingManagers = await ManagerTeam.find({ team: transfer.fromTeam });
      for (const sm of sellingManagers) {
        await NotificationQueueHelper.sendNotification(
          sm.manager.toString(),
          `${playerName} has accepted the transfer bid from ${toTeamName}. Your club manager approval is required.`,
          'Player Accepted Transfer Bid',
          NOTIFICATION_TYPE.GENERAL,
          USER_ROLES.MANAGER,
          transfer._id.toString(),
          'Transfer'
        );
      }
    }
  }

  return {
    message: isManagerApproved
      ? 'Transfer approved by both player and manager! Awaiting final Admin approval.'
      : 'Transfer approved by player. Awaiting current club manager approval.',
    transfer,
  };
};

// 7. CURRENT CLUB MANAGER CONSENT RESPONSE (APPROVE / REJECT)
const respondByManagerToDB = async (
  transferId: string,
  userId: string,
  payload: { action: 'APPROVE' | 'REJECT'; reason?: string }
) => {
  const transfer = await Transfer.findById(transferId);
  if (!transfer) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Transfer request not found.');
  }

  if (!transfer.isLiveMarket) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This endpoint is only for Live Transfer Market requests.'
    );
  }

  // Ensure caller is the manager of the player's CURRENT team
  if (transfer.fromTeam) {
    const isFromManager = await ManagerTeam.findOne({
      manager: userId,
      team: transfer.fromTeam,
    });

    if (!isFromManager) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Access Denied: Only the manager of the player's current team can respond to this transfer request."
      );
    }
  }

  if (transfer.status === 'APPROVED') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This transfer is already completed.');
  }

  if (transfer.status === 'REJECTED' || transfer.status === 'WITHDRAWN') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This transfer request has already been closed or rejected.'
    );
  }

  const player = await User.findById(transfer.player);
  const playerName = player
    ? `${player.firstName || ''} ${player.lastName || player.userName || 'Player'}`.trim()
    : 'Player';
  const toTeamObj = await Team.findById(transfer.toTeam);
  const toTeamName = toTeamObj?.teamName || 'New Club';

  if (payload.action === 'REJECT') {
    transfer.managerApproval = {
      status: 'REJECTED',
      respondedAt: new Date(),
      rejectReason: payload.reason || 'Declined by club manager',
      respondedBy: new mongoose.Types.ObjectId(userId) as any,
    };
    transfer.status = 'REJECTED';
    transfer.rejectReason = payload.reason || 'Declined by club manager';
    await transfer.save();

    // Notify buying manager
    await NotificationQueueHelper.sendNotification(
      transfer.requestedBy.toString(),
      `The club manager has declined your transfer bid for ${playerName} to join ${toTeamName}.`,
      'Transfer Bid Declined by Club',
      NOTIFICATION_TYPE.TRANSFER_REJECTED,
      USER_ROLES.MANAGER,
      transfer._id.toString(),
      'Transfer'
    );

    // Notify player
    await NotificationQueueHelper.sendNotification(
      transfer.player.toString(),
      `Your club manager has declined the transfer bid from ${toTeamName}. You remain with your current club.`,
      'Transfer Bid Declined by Manager',
      NOTIFICATION_TYPE.GENERAL,
      USER_ROLES.PLAYER,
      transfer._id.toString(),
      'Transfer'
    );

    return {
      message: 'Transfer offer rejected. Player remains in current club.',
      transfer,
    };
  }

  // Action: APPROVE
  transfer.managerApproval = {
    status: 'APPROVED',
    respondedAt: new Date(),
    rejectReason: null,
    respondedBy: new mongoose.Types.ObjectId(userId) as any,
  };

  // Check if player has also approved
  const isPlayerApproved = transfer.playerApproval?.status === 'APPROVED';

  if (isPlayerApproved) {
    // BOTH PARTIES HAVE APPROVED -> READY FOR ADMIN FINAL APPROVAL
    transfer.status = 'BOTH_APPROVED';
    await transfer.save();

    // Notify Admin
    await sendNotificationToAdmins({
      title: 'Live Transfer Approved by Both Parties',
      message: `Transfer for ${playerName} to ${toTeamName} has been approved by BOTH the player and current club manager. Final Admin approval is required.`,
      type: NOTIFICATION_TYPE.TRANSFER_REQUESTED,
      metadata: { transferId: transfer._id, isLiveMarket: true },
    });

    // Notify buying manager
    await NotificationQueueHelper.sendNotification(
      transfer.requestedBy.toString(),
      `Great news! Both ${playerName} and their current club manager have accepted your transfer bid. The transfer is now awaiting final Admin approval.`,
      'Transfer Bid Accepted by Both Parties',
      NOTIFICATION_TYPE.GENERAL,
      USER_ROLES.MANAGER,
      transfer._id.toString(),
      'Transfer'
    );
  } else {
    // Manager approved, but player is still pending
    await transfer.save();

    // Notify player that manager has accepted the bid
    await NotificationQueueHelper.sendNotification(
      transfer.player.toString(),
      `Your club manager has approved the transfer bid from ${toTeamName}. Your approval is required.`,
      'Club Manager Approved Transfer Bid',
      NOTIFICATION_TYPE.GENERAL,
      USER_ROLES.PLAYER,
      transfer._id.toString(),
      'Transfer'
    );
  }

  return {
    message: isPlayerApproved
      ? 'Transfer approved by both player and manager! Awaiting final Admin approval.'
      : 'Transfer approved by club manager. Awaiting player consent.',
    transfer,
  };
};

// 8. GET OFFERS RECEIVED (SMART FOR PLAYER, PARENT, AND MANAGER)
const getMyOffersFromDB = async (userId: string, userRole: string, playerId?: string) => {
  const userStrId = userId.toString();
  const userObjId = mongoose.Types.ObjectId.isValid(userStrId)
    ? new mongoose.Types.ObjectId(userStrId)
    : null;

  // 1. If caller is a MANAGER:
  if (userRole === USER_ROLES.MANAGER) {
    // Find all teams managed by this manager
    const managerTeams = await ManagerTeam.find({
      $or: [
        { manager: userStrId },
        ...(userObjId ? [{ manager: userObjId }] : []),
      ],
    });
    const teamIds = managerTeams.map((mt) => mt.team);

    if (!teamIds.length) {
      return [];
    }

    // Return all incoming bids received for players belonging to this manager's team
    return await Transfer.find({
      fromTeam: { $in: teamIds },
      isLiveMarket: true,
    })
      .sort({ createdAt: -1 })
      .populate('player', 'firstName lastName userName email profile position engCoine marketValue')
      .populate('toTeam', 'teamName logo clubCode')
      .populate('fromTeam', 'teamName logo clubCode')
      .populate('requestedBy', 'firstName lastName profile email');
  }

  // 2. If specific playerId query param is passed:
  if (playerId) {
    const targetPlayerId = await resolveTargetPlayerId(userId, userRole, playerId);
    return await Transfer.find({
      player: targetPlayerId,
      isLiveMarket: true,
    })
      .sort({ createdAt: -1 })
      .populate('player', 'firstName lastName userName email profile position engCoine marketValue')
      .populate('toTeam', 'teamName logo clubCode')
      .populate('fromTeam', 'teamName logo clubCode')
      .populate('requestedBy', 'firstName lastName profile email');
  }

  // 3. Check if caller is a PARENT (has children in User model)
  const children = await User.find({
    $or: [
      { parentId: userStrId },
      ...(userObjId ? [{ parentId: userObjId }] : []),
    ],
  }).select('_id');

  if (children.length > 0) {
    const childIds = children.map((c) => c._id);
    return await Transfer.find({
      player: { $in: childIds },
      isLiveMarket: true,
    })
      .sort({ createdAt: -1 })
      .populate('player', 'firstName lastName userName email profile position engCoine marketValue')
      .populate('toTeam', 'teamName logo clubCode')
      .populate('fromTeam', 'teamName logo clubCode')
      .populate('requestedBy', 'firstName lastName profile email');
  }

  // 4. Default: caller is the player themself
  return await Transfer.find({
    player: userObjId || userStrId,
    isLiveMarket: true,
  })
    .sort({ createdAt: -1 })
    .populate('player', 'firstName lastName userName email profile position engCoine marketValue')
    .populate('toTeam', 'teamName logo clubCode')
    .populate('fromTeam', 'teamName logo clubCode')
    .populate('requestedBy', 'firstName lastName profile email');
};

// 9. GET LIVE MARKET BIDS FOR SELLING CLUB (SELLING MANAGER)
const getSellingRequestsFromDB = async (userId: string) => {
  const userStrId = userId.toString();
  const userObjId = mongoose.Types.ObjectId.isValid(userStrId)
    ? new mongoose.Types.ObjectId(userStrId)
    : null;

  const managerTeams = await ManagerTeam.find({
    $or: [
      { manager: userStrId },
      ...(userObjId ? [{ manager: userObjId }] : []),
    ],
  });

  if (!managerTeams.length) {
    return [];
  }

  const teamIds = managerTeams.map((mt) => mt.team);

  const requests = await Transfer.find({
    fromTeam: { $in: teamIds },
    isLiveMarket: true,
  })
    .sort({ createdAt: -1 })
    .populate('player', 'firstName lastName userName email profile position engCoine marketValue')
    .populate('toTeam', 'teamName logo clubCode')
    .populate('fromTeam', 'teamName logo clubCode')
    .populate('requestedBy', 'firstName lastName profile email');

  return requests;
};

// 10. GET LIVE MARKET BIDS SENT BY BUYING CLUB (BUYING MANAGER)
const getBuyingRequestsFromDB = async (userId: string) => {
  const userStrId = userId.toString();
  const userObjId = mongoose.Types.ObjectId.isValid(userStrId)
    ? new mongoose.Types.ObjectId(userStrId)
    : null;

  const requests = await Transfer.find({
    requestedBy: { $in: [userStrId, ...(userObjId ? [userObjId] : [])] },
    isLiveMarket: true,
  })
    .sort({ createdAt: -1 })
    .populate('player', 'firstName lastName userName email profile position engCoine marketValue')
    .populate('fromTeam', 'teamName logo clubCode')
    .populate('toTeam', 'teamName logo clubCode');

  return requests;
};

// 11. GET SINGLE LIVE TRANSFER DETAILS
const getSingleLiveTransferFromDB = async (id: string, currentUser?: any) => {
  const transfer = await Transfer.findById(id)
    .populate('player', 'firstName lastName userName email profile position engCoine marketValue dateOfBirth height weight')
    .populate('fromTeam', 'teamName logo clubCode')
    .populate('toTeam', 'teamName logo clubCode')
    .populate('requestedBy', 'firstName lastName profile email')
    .populate('approvedBy', 'firstName lastName profile email')
    .populate('liveMarketListing');

  if (!transfer) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Transfer request not found.');
  }

  if (currentUser) {
    const role = currentUser.role;
    const currentUserId = (currentUser._id || currentUser.id)?.toString();
    const isAdmin = role === USER_ROLES.ADMIN || role === USER_ROLES.SUPER_ADMIN;
    const isPlayer = (transfer.player as any)?._id?.toString() === currentUserId || transfer.player?.toString() === currentUserId;
    const isRequestedBy = (transfer.requestedBy as any)?._id?.toString() === currentUserId || transfer.requestedBy?.toString() === currentUserId;

    if (!isAdmin && !isPlayer && !isRequestedBy) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'You are not authorized to view this live transfer details');
    }
  }

  return transfer;
};

export const LiveTransferMarketService = {
  joinMarketToDB,
  leaveMarketToDB,
  getMyListingFromDB,
  getLiveMarketPlayersFromDB,
  requestLiveTransferToDB,
  respondByPlayerToDB,
  respondByManagerToDB,
  getMyOffersFromDB,
  getSellingRequestsFromDB,
  getBuyingRequestsFromDB,
  getSingleLiveTransferFromDB,
};

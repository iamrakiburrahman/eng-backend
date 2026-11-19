/* eslint-disable @typescript-eslint/no-explicit-any */
import colors from 'colors';
import mongoose from 'mongoose';
import { Match } from '../app/modules/match/match.model';
import { VenueCategory } from '../app/modules/venueCategory/venueCategory.model';
import { TeamSubscription } from '../app/modules/teamSubscription/teamSubscription.model';
import { ManagerTeam } from '../app/modules/managerTeam/managerTeam.model';
import { User } from '../app/modules/user/user.model';
import { NotificationHelper } from '../app/builder/PushNotifications';
import { NOTIFICATION_TYPE } from '../app/modules/notification/notification.interface';
import { getEffectiveMatchSetting, IMatchSetting } from '../app/modules/match/matchSetting.model';
import { resolveNotificationRecipients } from '../app/modules/pushNotification/pushNotification.service';
import { logger } from '../shared/logger';

export interface IMatchReminderResult {
  processedMatches: number;
  totalRecipients: number;
}

/**
 * Resolves human-readable venue name from match fields (handles raw text, VenueCategory ObjectIds, populated objects)
 */
export async function resolveMatchVenueName(match: any): Promise<string> {
  if (!match) return '';

  const parts: string[] = [];
  let rawVenueName = (match.venueName || '').toString().trim();

  // 1. If rawVenueName is an ObjectId hex string, resolve its VenueCategory document
  if (rawVenueName && mongoose.Types.ObjectId.isValid(rawVenueName)) {
    try {
      const venueCatDoc = await VenueCategory.findById(rawVenueName)
        .populate('parentCategory', 'name')
        .lean();
      if (venueCatDoc) {
        if (venueCatDoc.parentCategory && (venueCatDoc.parentCategory as any).name) {
          parts.push((venueCatDoc.parentCategory as any).name);
        }
        parts.push(venueCatDoc.name);
        rawVenueName = ''; // reset since resolved
      }
    } catch {
      // Ignore fallback
    }
  }

  // 2. If venueCategory is present
  if (match.venueCategory) {
    if (typeof match.venueCategory === 'object' && match.venueCategory.name) {
      if (!parts.includes(match.venueCategory.name)) parts.push(match.venueCategory.name);
    } else if (mongoose.Types.ObjectId.isValid(match.venueCategory)) {
      try {
        const vCat = await VenueCategory.findById(match.venueCategory).lean();
        if (vCat && !parts.includes(vCat.name)) parts.push(vCat.name);
      } catch {
        // Ignore fallback
      }
    }
  }

  // 3. If venueSubCategory is present
  if (match.venueSubCategory) {
    if (typeof match.venueSubCategory === 'object' && match.venueSubCategory.name) {
      if (!parts.includes(match.venueSubCategory.name)) parts.push(match.venueSubCategory.name);
    } else if (mongoose.Types.ObjectId.isValid(match.venueSubCategory)) {
      try {
        const vSub = await VenueCategory.findById(match.venueSubCategory).lean();
        if (vSub && !parts.includes(vSub.name)) parts.push(vSub.name);
      } catch {
        // Ignore fallback
      }
    }
  }

  // 4. Add raw text venueName if it is not an ObjectId and not already included
  if (rawVenueName && !mongoose.Types.ObjectId.isValid(rawVenueName) && !parts.includes(rawVenueName)) {
    parts.push(rawVenueName);
  }

  // 5. Fallback to match.venue if present
  if (parts.length === 0 && match.venue && typeof match.venue === 'string' && !mongoose.Types.ObjectId.isValid(match.venue)) {
    parts.push(match.venue);
  }

  return parts.length > 0 ? parts.join(', ') : (mongoose.Types.ObjectId.isValid(match.venueName) ? '' : match.venueName || '');
}

/**
 * Replaces dynamic placeholders in reminder templates
 */
function formatTemplate(
  template: string,
  hName: string,
  aName: string,
  dateStr: string,
  timeStr: string,
  venue: string,
  relativeDay: string = 'tomorrow'
): string {
  const venueTrimmed = venue ? venue.trim() : '';

  let result = template
    .replace(/\{homeTeam\}/gi, hName)
    .replace(/\{awayTeam\}/gi, aName)
    .replace(/\{date\}/gi, dateStr)
    .replace(/\{time\}/gi, timeStr)
    .replace(/\{relativeDay\}/gi, relativeDay);

  // Safe {venue} injection (prevents double "at at")
  if (venueTrimmed) {
    if (/at\s+\{venue\}/i.test(result)) {
      result = result.replace(/at\s+\{venue\}/gi, `at ${venueTrimmed}`);
    } else {
      result = result.replace(/\{venue\}/gi, ` at ${venueTrimmed}`);
    }
  } else {
    result = result.replace(/\s*at\s*\{venue\}/gi, '').replace(/\{venue\}/gi, '');
  }

  // If the user's template contains the word "tomorrow", automatically adjust if the match is today
  if (relativeDay === 'today') {
    result = result.replace(/\btomorrow\b/gi, 'today');
  } else if (relativeDay.startsWith('in ') && !template.includes('{relativeDay}')) {
    result = result.replace(/\btomorrow\b/gi, relativeDay);
  }

  // Absolute fail-safe: Ensure no raw 24-char ObjectId is ever sent to users
  if (/[0-9a-fA-F]{24}/.test(result)) {
    result = result.replace(/\s*at\s*[0-9a-fA-F]{24}/gi, venueTrimmed ? ` at ${venueTrimmed}` : '');
    result = result.replace(/[0-9a-fA-F]{24}/gi, '');
  }

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Resolves all recipient user IDs for a given match based on audience setting
 */
export async function resolveMatchRecipients(
  match: any,
  audience: 'STAKEHOLDERS' | 'ALL' = 'STAKEHOLDERS'
): Promise<string[]> {
  // Option 1: Broadcast to ALL verified app account owners
  if (audience === 'ALL') {
    const { userIds } = await resolveNotificationRecipients(null, 'ALL');
    return (userIds || []).map((id: any) => id.toString());
  }

  // Option 2: Target match stakeholders (Teams, Players, Parents, Managers, Subscribers, Referee)
  const homeTeamId = match.homeTeam?._id || match.homeTeam;
  const awayTeamId = match.awayTeam?._id || match.awayTeam;
  const teamIds = [homeTeamId, awayTeamId].filter(Boolean);

  const recipientSet = new Set<string>();

  if (teamIds.length > 0) {
    const [teamUsers, subscribers, managerTeams, directManagers] = await Promise.all([
      // A. Players and users with selectTeam
      User.find({
        selectTeam: { $in: teamIds },
        verified: true,
      })
        .select('_id parentId role')
        .lean(),

      // B. Team subscribers with active bell
      TeamSubscription.find({
        team: { $in: teamIds },
        isBellActive: true,
      })
        .select('user')
        .lean(),

      // C. Managers assigned through ManagerTeam
      ManagerTeam.find({
        team: { $in: teamIds },
      })
        .select('manager')
        .lean(),

      // D. Direct team managers
      User.find({
        role: 'MANAGER',
        selectTeam: { $in: teamIds },
        verified: true,
      })
        .select('_id')
        .lean(),
    ]);

    // Add team users + their parents if child profile
    (teamUsers || []).forEach((u: any) => {
      if (u._id) recipientSet.add(u._id.toString());
      if (u.parentId) recipientSet.add(u.parentId.toString());
    });

    // Add subscribers
    (subscribers || []).forEach((s: any) => {
      const id = s.user?.toString();
      if (id) recipientSet.add(id);
    });

    // Add manager teams
    (managerTeams || []).forEach((m: any) => {
      const id = m.manager?.toString();
      if (id) recipientSet.add(id);
    });

    // Add direct managers
    (directManagers || []).forEach((u: any) => {
      const id = u._id?.toString();
      if (id) recipientSet.add(id);
    });
  }

  // Add referee if assigned
  if (match.referee) {
    recipientSet.add(match.referee.toString());
  }

  return Array.from(recipientSet);
}

/**
 * Dispatches a reminder for a single match
 */
export async function sendSingleMatchReminder(
  matchId: string,
  options?: { force?: boolean; setting?: IMatchSetting }
): Promise<{ success: boolean; matchId: string; recipientCount: number; message: string }> {
  const match = await Match.findById(matchId)
    .populate('homeTeam', 'teamName logo')
    .populate('awayTeam', 'teamName logo')
    .populate('league', 'leagueName')
    .populate('venueCategory', 'name')
    .populate('venueSubCategory', 'name')
    .lean();

  if (!match) {
    throw new Error('Match not found');
  }

  if (!options?.force && match.oneDayReminderSent) {
    return {
      success: true,
      matchId,
      recipientCount: 0,
      message: 'Reminder was already sent previously.',
    };
  }

  const setting = options?.setting || (await getEffectiveMatchSetting());
  const hName = (match.homeTeam as any)?.teamName || 'Home Team';
  const aName = (match.awayTeam as any)?.teamName || 'Away Team';
  const venue = await resolveMatchVenueName(match);

  const matchTime = new Date(match.matchDate || match.scheduledAt);
  const targetTz = setting.timezone || 'Europe/London';

  let timeStr = '';
  let dateStr = '';
  try {
    timeStr = matchTime.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: targetTz,
    });
    dateStr = matchTime.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: targetTz,
    });
  } catch {
    timeStr = matchTime.toISOString().slice(11, 16);
    dateStr = matchTime.toISOString().slice(0, 10);
  }

  // Calculate calendar day difference in target timezone
  let relativeDay = 'tomorrow';
  try {
    const now = new Date();
    const nowDateStr = now.toLocaleDateString('en-CA', { timeZone: targetTz }); // YYYY-MM-DD
    const matchDateStr = matchTime.toLocaleDateString('en-CA', { timeZone: targetTz }); // YYYY-MM-DD
    const msDiff = new Date(matchDateStr).getTime() - new Date(nowDateStr).getTime();
    const dayDiff = Math.round(msDiff / (1000 * 60 * 60 * 24));

    if (dayDiff === 0) {
      relativeDay = 'today';
    } else if (dayDiff === 1) {
      relativeDay = 'tomorrow';
    } else if (dayDiff > 1) {
      relativeDay = `in ${dayDiff} days`;
    }
  } catch {
    relativeDay = 'tomorrow';
  }

  const rawTitle = setting.customReminderTitle || 'Match Reminder: {homeTeam} vs {awayTeam}';
  const rawBody =
    setting.customReminderMessage ||
    'Upcoming match: {homeTeam} vs {awayTeam} kicks off tomorrow ({date}) at {time}{venue}. Don\'t miss it!';

  const title = formatTemplate(rawTitle, hName, aName, dateStr, timeStr, venue, relativeDay);
  const body = formatTemplate(rawBody, hName, aName, dateStr, timeStr, venue, relativeDay);

  const recipientIds = await resolveMatchRecipients(match, setting.matchReminderAudience);

  if (recipientIds.length > 0) {
    const payload = {
      title,
      body,
      type: NOTIFICATION_TYPE.MATCH_REMINDER,
      reference: match._id.toString(),
      referenceModel: 'Match',
      data: {
        matchId: match._id.toString(),
        homeTeamId: String((match.homeTeam as any)?._id || match.homeTeam || ''),
        awayTeamId: String((match.awayTeam as any)?._id || match.awayTeam || ''),
        screen: 'MATCH_DETAILS',
      },
    };

    const CHUNK_SIZE = 500;
    for (let i = 0; i < recipientIds.length; i += CHUNK_SIZE) {
      const batch = recipientIds.slice(i, i + CHUNK_SIZE);
      await NotificationHelper.sendToBatch(batch, payload);
    }
  }

  await Match.findByIdAndUpdate(match._id, {
    oneDayReminderSent: true,
    oneDayReminderSentAt: new Date(),
  });

  return {
    success: true,
    matchId,
    recipientCount: recipientIds.length,
    message: `Reminder sent to ${recipientIds.length} recipients.`,
  };
}

/**
 * Automatically checks upcoming matches and sends reminders according to dynamic settings
 */
export async function checkAndSendUpcomingMatchReminders(): Promise<IMatchReminderResult> {
  const setting = await getEffectiveMatchSetting();

  if (!setting.isMatchReminderEnabled) {
    logger.info(colors.yellow('[Match Reminders] Automated match reminders are currently disabled in settings.'));
    return { processedMatches: 0, totalRecipients: 0 };
  }

  const now = new Date();
  const reminderHours = Number(setting.matchReminderHours) || 24;
  // Dynamic forward window with 4-hour buffer to smoothly capture upcoming fixtures
  const maxFuture = new Date(now.getTime() + (reminderHours + 4) * 60 * 60 * 1000);

  let processedMatches = 0;
  let totalRecipients = 0;

  try {
    const upcomingMatches = await Match.find({
      status: { $in: ['upcoming', 'scheduled'] },
      oneDayReminderSent: { $ne: true },
      $or: [
        { matchDate: { $gte: now, $lte: maxFuture } },
        { scheduledAt: { $gte: now, $lte: maxFuture } },
      ],
    })
      .populate('homeTeam', 'teamName logo')
      .populate('awayTeam', 'teamName logo')
      .populate('league', 'leagueName')
      .lean();

    if (!upcomingMatches || upcomingMatches.length === 0) {
      return { processedMatches: 0, totalRecipients: 0 };
    }

    logger.info(
      colors.cyan(
        `[Match Reminders] Found ${upcomingMatches.length} matches within ${reminderHours}h window to notify.`
      )
    );

    for (const match of (upcomingMatches as any[])) {
      // 1. Atomically claim this match
      const claimed = await Match.findOneAndUpdate(
        { _id: match._id, oneDayReminderSent: { $ne: true } },
        { $set: { oneDayReminderSent: true, oneDayReminderSentAt: new Date() } }
      );

      if (!claimed) continue;

      try {
        const res = await sendSingleMatchReminder(match._id.toString(), { force: true, setting });
        processedMatches++;
        totalRecipients += res.recipientCount;
      } catch (sendErr) {
        logger.error(colors.red(`[Match Reminders] Error sending reminder for match ${match._id}:`), sendErr);
      }
    }

    return { processedMatches, totalRecipients };
  } catch (error) {
    logger.error(colors.red('Error in checkAndSendUpcomingMatchReminders:'), error);
    return { processedMatches, totalRecipients };
  }
}

/**
 * Fetches upcoming matches for admin dashboard preview along with recipient counts & reminder status
 */
export async function getUpcomingMatchesForAdminPreview(options?: {
  limit?: number;
  page?: number;
  search?: string;
  status?: string;
}) {
  const limit = Math.min(100, Math.max(1, Number(options?.limit) || 20));
  const page = Math.max(1, Number(options?.page) || 1);
  const skip = (page - 1) * limit;

  const now = new Date();
  const filter: any = {
    status: { $in: ['upcoming', 'scheduled'] },
    matchDate: { $gte: now },
  };

  if (options?.status === 'SENT') {
    filter.oneDayReminderSent = true;
  } else if (options?.status === 'PENDING') {
    filter.oneDayReminderSent = { $ne: true };
  }

  const [matches, total] = await Promise.all([
    Match.find(filter)
      .sort({ matchDate: 1 })
      .skip(skip)
      .limit(limit)
      .populate('homeTeam', 'teamName logo')
      .populate('awayTeam', 'teamName logo')
      .populate('league', 'leagueName logo')
      .populate('venueCategory', 'name')
      .populate('venueSubCategory', 'name')
      .lean(),
    Match.countDocuments(filter),
  ]);

  const setting = await getEffectiveMatchSetting();

  // Estimate stakeholder recipient count and resolve venue name for each match
  const matchesWithRecipients = await Promise.all(
    matches.map(async (m: any) => {
      const [recipientIds, resolvedVenue] = await Promise.all([
        resolveMatchRecipients(m, setting.matchReminderAudience),
        resolveMatchVenueName(m),
      ]);
      return {
        ...m,
        venueName: resolvedVenue || '',
        recipientCount: recipientIds.length,
      };
    })
  );

  return {
    matches: matchesWithRecipients,
    pagination: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    setting,
  };
}

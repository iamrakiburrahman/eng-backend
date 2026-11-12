/**
 * Extracts only allowlisted own properties from an object to prevent Mass Assignment
 * and MongoDB operator injection ($set, $inc, etc.).
 */
const pick = <T extends Record<string, any>, K extends string>(
  obj: T,
  keys: readonly K[],
): Partial<Record<K, any>> => {
  const finalObj: Partial<Record<K, any>> = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return finalObj;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(obj, key) &&
      obj[key] !== undefined
    ) {
      finalObj[key] = obj[key];
    }
  }

  return finalObj;
};

export const USER_SELF_EDITABLE_FIELDS = [
  "userName",
  "firstName",
  "lastName",
  "phone",
  "location",
  "profile",
  "fcmToken",
  "dateOfBirth",
  "ageGroup",
  "strongFoot",
  "position",
  "jerseyNumber",
  "selectTeam",
  "previousClub",
  "debutDate",
  "playForAcademy",
  "academyClubName",
  "isDevelopmentPlayer",
  "mediaConsent",
  "emergencyEmail",
  "emergencyPhone",
  "document",
] as const;

export const USER_ADMIN_EDITABLE_FIELDS = [
  ...USER_SELF_EDITABLE_FIELDS,
  "engCoine",
  "marketValue",
  "status",
  "rejectionReason",
  "blueTick",
  "rewardPoint",
  "verified",
  "isSubscribed",
  "hasAccess",
] as const;

export default pick;


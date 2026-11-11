import colors from "colors";
import { logger } from "../shared/logger";
import { getRedisClient, isRedisReady } from "../DB/redis";

// Local fallback cache for deduplication when Redis is unavailable
const dedupCache = new Map<string, number>();

// Cleanup expired keys every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of dedupCache.entries()) {
    if (now >= expiresAt) {
      dedupCache.delete(key);
    }
  }
}, 60000).unref(); // unref so it does not keep process alive unnecessarily

/**
 * Check if a notification is a duplicate within a given time-to-live window.
 * Uses Redis atomic SET NX EX in cluster mode so deduplication works across all workers,
 * falling back to process-local memory if Redis is unavailable.
 */
export async function isDuplicateNotification(
  key: string,
  ttlSeconds: number = 60,
): Promise<boolean> {
  if (!key) return false;

  const safeTtl = Math.max(1, Math.floor(ttlSeconds));
  const redisClient = getRedisClient();

  if (redisClient && isRedisReady()) {
    try {
      const acquired = await redisClient.set(`notif_dedup:${key}`, "1", {
        NX: true,
        EX: safeTtl,
      });
      if (acquired === null) {
        logger.warn(
          colors.yellow(
            `[Notification Deduplication] Dropped duplicate notification trigger for key: "${key}" (cooldown active)`
          )
        );
        return true;
      }
      return false;
    } catch {
      // Fallback to local memory cache on transient Redis error
    }
  }

  const now = Date.now();
  const existingExpiresAt = dedupCache.get(key);

  if (existingExpiresAt && now < existingExpiresAt) {
    logger.warn(
      colors.yellow(
        `[Notification Deduplication] Dropped duplicate notification trigger for key: "${key}" (cooldown active)`
      )
    );
    return true; // Is duplicate
  }

  // Record this key with expiration
  dedupCache.set(key, now + safeTtl * 1000);
  return false; // Not a duplicate
}

/**
 * Clear a key from deduplication cache (e.g. if queueing failed)
 */
export async function clearDuplicateNotification(key: string): Promise<void> {
  if (!key) return;

  dedupCache.delete(key);
  const redisClient = getRedisClient();
  if (redisClient && isRedisReady()) {
    try {
      await redisClient.del(`notif_dedup:${key}`);
    } catch {
      // Ignore cleanup error
    }
  }
}

/**
 * Generate a deterministic deduplication key for a team notification
 */
export function generateTeamNotificationDedupKey(options: {
  teamId: string;
  type?: string;
  eventType?: string;
  referenceId?: string;
  minute?: string | number;
  playerId?: string;
  action?: string;
  period?: string;
}): string {
  const parts = [
    "team_notif",
    options.teamId,
    options.type || "UPDATE",
    options.eventType || "GENERAL",
    options.referenceId || "NONE",
    options.playerId || "NONE",
    options.minute !== undefined && options.minute !== "" ? `m${options.minute}` : "NONE",
    options.period || "NONE",
    options.action || "NONE",
  ];

  return parts.join("_").replace(/[:\s\r\n]+/g, "_");
}

/**
 * Generate a deterministic deduplication key for a single user notification
 */
export function generateUserNotificationDedupKey(options: {
  userId: string;
  type?: string;
  reference?: string;
  title?: string;
}): string {
  const parts = [
    "user_notif",
    options.userId,
    options.type || "GENERAL",
    options.reference || "NONE",
    options.title ? Buffer.from(options.title).toString("base64").substring(0, 16) : "NONE",
  ];

  return parts.join("_").replace(/[:\s\r\n]+/g, "_");
}

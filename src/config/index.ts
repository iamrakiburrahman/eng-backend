import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const buildRedisConfig = () => {
  const rawUrl = process.env.REDIS_URL?.trim();
  const envHost = process.env.REDIS_HOST?.trim() || "localhost";
  const envPort = Number(process.env.REDIS_PORT?.trim() || "6379") || 6379;
  const envUsername = process.env.REDIS_USERNAME?.trim();
  const envPassword = process.env.REDIS_PASSWORD?.trim();
  const envDb =
    process.env.REDIS_DB !== undefined && process.env.REDIS_DB.trim() !== ""
      ? Number(process.env.REDIS_DB.trim())
      : undefined;

  if (rawUrl) {
    try {
      const normalized = /^rediss?:\/\//i.test(rawUrl) ? rawUrl : `redis://${rawUrl}`;
      const parsed = new URL(normalized);
      if (!parsed.password && envPassword) {
        parsed.password = envPassword;
      }
      if (!parsed.username && envUsername) {
        parsed.username = envUsername;
      }
      const dbFromPath =
        parsed.pathname && parsed.pathname.length > 1
          ? Number(parsed.pathname.slice(1))
          : undefined;

      return {
        url: parsed.toString(),
        host: parsed.hostname || envHost,
        port: parsed.port ? Number(parsed.port) : envPort,
        username: parsed.username ? decodeURIComponent(parsed.username) : envUsername || undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : envPassword || undefined,
        db: Number.isFinite(envDb) ? Number(envDb) : Number.isFinite(dbFromPath) ? Number(dbFromPath) : 0,
      };
    } catch {
      return {
        url: rawUrl,
        host: envHost,
        port: envPort,
        username: envUsername || undefined,
        password: envPassword || undefined,
        db: Number.isFinite(envDb) ? Number(envDb) : 0,
      };
    }
  }

  const protocol = process.env.REDIS_TLS === "true" ? "rediss" : "redis";
  const authPart = envPassword
    ? `${envUsername ? encodeURIComponent(envUsername) : ""}:${encodeURIComponent(envPassword)}@`
    : "";

  return {
    url: `${protocol}://${authPart}${envHost}:${envPort}`,
    host: envHost,
    port: envPort,
    username: envUsername || undefined,
    password: envPassword || undefined,
    db: Number.isFinite(envDb) ? Number(envDb) : 0,
  };
};
const redisConfig = buildRedisConfig();

export default {
  ip_address: process.env.IP_ADDRESS,
  port: process.env.PORT,
  database_url: process.env.DATABASE_URL,
  node_env: process.env.NODE_ENV,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  jwt: {
    jwt_secret: process.env.JWT_SECRET,
    jwt_expire_in: process.env.JWT_EXPIRE_IN,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  },
  server: {
    name: process.env.SERVER_NAME || "ENG Backend",
  },
  stripe: {
    stripeSecretKey: process.env.STRIPE_API_SECRET,
    webhookSecret: process.env.WEBHOOK_SECRET,
    backendURL: process.env.BACKEND_URL,
  },
  email: {
    apiKey: process.env.API_KEY,
    emailHeader: process.env.EMAIL_HEADER_NAME,
    from: process.env.EMAIL_FROM,
  },
  social: {
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    facebook_client_id: process.env.FACEBOOK_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    facebook_client_secret: process.env.FACEBOOK_CLIENT_SECRET,
  },
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    twilioNumber: process.env.TWILIO_NUMBER,
  },
  veevoTech: {
    apiKey: process.env.VEEVOTECH_API_KEY,
    senderId: process.env.VEEVOTECH_SENDER_ID,
  },
  m3Sms: {
    userId: process.env.M3_SMS_USER_ID,
    password: process.env.M3_SMS_PASSWORD,
    header: process.env.M3_SMS_HEADER,
    url: process.env.M3_SMS_URL,
  },
  frontendUrl: process.env.FRONTEND_URL,
  redis: {
    url: redisConfig.url,
    host: redisConfig.host,
    port: redisConfig.port,
    username: redisConfig.username,
    password: redisConfig.password,
    db: redisConfig.db,
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  },
  allowed_origins: process.env.ALLOWED_ORIGINS,
};

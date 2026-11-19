import rateLimit from 'express-rate-limit';

// Global API rate limiter: 2000 requests per minute per IP
export const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many requests, please try again in a moment.',
  },
});

// Image / static files rate limiter: 3000 requests per minute per IP
export const imageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many image requests, please try again later.',
  },
});

// Authentication endpoints rate limiter: max 10 requests per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
});

// OTP verification limiter: max 5 requests per 5 minutes per IP
export const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many OTP verification attempts. Please try again after 5 minutes.',
  },
});

// Click/View metric tracking limiter: max 60 requests per minute per IP to prevent spam inflation
export const trackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many tracking requests, please slow down.',
  },
});

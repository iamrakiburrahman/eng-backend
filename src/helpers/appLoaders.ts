import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { StatusCodes } from 'http-status-codes';
import { Morgan } from '../shared/morgan';
import { errorLogger } from '../shared/logger';
import config from '../config';
import handleStripeWebhook from './handleStripeWebhook';
import router from '../app/routes';
import { globalLimiter, imageLimiter } from '../app/middlewares/rateLimiter';
import { maintenanceMiddleware } from '../app/middlewares/maintenanceMiddleware';
import globalErrorHandler from '../app/middlewares/globalErrorHandler';
import { welcome } from '../util/welcome';
const normalizeOrigin = (raw: string): string => {
     const cleaned = raw.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
     if (!cleaned || cleaned === '*') return cleaned;
     try {
          return new URL(cleaned).origin.toLowerCase();
     } catch {
          return cleaned.toLowerCase();
     }
};

const rawAllowedOrigins = [
     ...(config.allowed_origins ? config.allowed_origins.split(',') : []),
     ...(config.frontendUrl && /^https?:\/\//i.test(config.frontendUrl)
          ? [config.frontendUrl]
          : []),
];

export const allowedOrigins = Array.from(
     new Set(rawAllowedOrigins.map(normalizeOrigin).filter(Boolean)),
);

export const corsOriginValidator = (
     origin: string | undefined,
     callback: (err: Error | null, allow?: boolean) => void,
): void => {
     // Allow requests with no origin (like mobile apps, curl, postman)
     if (!origin) return callback(null, true);

     // In development, reflect request origin to bypass wildcard restriction with credentials
     if (config.node_env !== 'production') {
          return callback(null, true);
     }

     const normalized = normalizeOrigin(origin);
     if (allowedOrigins.includes('*') || allowedOrigins.includes(normalized)) {
          return callback(null, true);
     }

     errorLogger.error(
          `[CORS] Blocked origin: "${origin}" (normalized: "${normalized}"). Allowed origins: [${allowedOrigins.join(', ')}]`,
     );
     return callback(new Error('Not allowed by CORS'));
};
export function configureMiddlewares(app: Express): void {
     // ✅ EJS view engine for Stripe payment redirect pages
     app.set('view engine', 'ejs');
     app.set('views', path.join(process.cwd(), 'views'));

     app.post(
          '/api/v1/payment/webhook',
          express.raw({ type: 'application/json' }),
          handleStripeWebhook
     );

     app.use(Morgan.successHandler);
     app.use(Morgan.errorHandler);

     app.use(
          cors({
               origin: corsOriginValidator,
               credentials: true,
               optionsSuccessStatus: 204,
          })
     );
     app.use(express.json({ limit: '50mb' }));
     app.use(express.urlencoded({ extended: true, limit: '50mb' }));

     app.use('/images', imageLimiter);
     app.use(express.static('uploads'));
     app.use('/images', express.static(path.join(process.cwd(), 'uploads', 'documents')));
     app.use('/documents', express.static(path.join(process.cwd(), 'uploads', 'images')));

     app.use(
          session({
               secret: process.env.SESSION_SECRET || config.jwt.jwt_secret || 'your_secret_key',
               resave: false,
               saveUninitialized: true,
               cookie: { secure: config.node_env === 'production' },
          })
     );
}

export function configureRoutes(app: Express): void {
     // Maintenance Mode Check (IP Whitelist / Bypass Key)
     app.use(maintenanceMiddleware);

     // Main API v1 routing under global rate limits
     app.use('/api/v1', globalLimiter, router);

     // ✅ Stripe Payment redirect pages (rendered via EJS) - ⚡ Instant synchronous rendering
     app.get('/payment/success', (req: Request, res: Response) => {
          const sessionId = (req.query.session_id as string) || '';
          const rawPackage = (req.query.package as string) || '';
          const packageName = rawPackage ? decodeURIComponent(rawPackage) : 'ENG Subscription Plan';

          res.render('payment-success', {
               sessionId: sessionId ? `${sessionId.substring(0, 16)}...` : 'N/A',
               packageName,
               date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
               year: new Date().getFullYear(),
               appUrl: config.frontendUrl || 'engapp://',
          });
     });

     app.get('/payment/cancel', (req: Request, res: Response) => {
          res.render('payment-cancel', {
               errorMessage: (req.query.reason as string) || 'Payment was cancelled by user',
               date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
               year: new Date().getFullYear(),
               appUrl: config.frontendUrl || 'engapp://',
          });
     });

     app.get('/payment/error', (req: Request, res: Response) => {
          res.render('payment-error', {
               errorMessage: (req.query.reason as string) || 'Payment processing failed',
               date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
               year: new Date().getFullYear(),
               appUrl: config.frontendUrl || 'engapp://',
               supportUrl: 'mailto:support@engsportsevents.co.uk',
          });
     });

     app.get('/', (req: Request, res: Response) => {
          res.send(welcome());
     });
}

export function configureErrorHandlers(app: Express): void {
     app.use(globalErrorHandler);
     app.use((req: Request, res: Response) => {
          res.status(StatusCodes.NOT_FOUND).json({
               success: false,
               message: 'Not Found',
               errorMessages: [
                    {
                         path: req.originalUrl,
                         message: "API DOESN'T EXIST",
                    },
               ],
          });
     });
}

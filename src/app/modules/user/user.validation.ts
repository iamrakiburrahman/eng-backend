import { z } from 'zod';
import { USER_ROLES } from '../../../enums/user';

const PUBLIC_SIGNUP_ROLES = [
  USER_ROLES.PLAYER,
  USER_ROLES.MANAGER,
  USER_ROLES.REFEREE,
  USER_ROLES.OTHER_CLUBS,
  USER_ROLES.TOURNAMENT_PLAYER,
] as const;

const createAdminZodSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    userName: z.string().optional(),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
      z.enum([USER_ROLES.ADMIN]).optional().default(USER_ROLES.ADMIN),
    ),
  }),
});
const createUserZodSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
    phone: z.string().optional(),
    phoneNumber: z.string().optional(),
    role: z
      .preprocess(
        (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
        z.enum(PUBLIC_SIGNUP_ROLES),
      )
      .optional(),
  }),
});

const createPlayerZodSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    dateOfBirth: z.string().optional(),
    ageGroup: z.string().optional(),
    previousClub: z.string().optional(),
    position: z.string().optional(),
    strongFoot: z.string().optional(),
    profile: z.string().optional(),
    document: z.union([z.string(), z.array(z.string())]).optional(),
    selectTeam: z.string().optional(),
    isDevelopmentPlayer: z.union([z.boolean(), z.string()]).optional(),
    mediaConsent: z.union([z.boolean(), z.string()]).optional(),
    playForAcademy: z.union([z.boolean(), z.string()]).optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    phoneNumber: z.string().optional(),
    emergencyEmail: z.string().optional(),
    emergencyPhone: z.string().optional(),
    data: z.any().optional(),
  }),
});

export const UserValidation = {
  createAdminZodSchema,
  createUserZodSchema,
  createPlayerZodSchema,
};  
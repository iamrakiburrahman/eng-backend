import { z } from 'zod';
import { USER_ROLES } from '../../../enums/user';

const createVerifyEmailZodSchema = z.object({
  body: z.object({
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .email({ message: "Invalid email address" }),
    oneTimeCode: z.number(),
  }),
});

const createLoginZodSchema = z.object({
  body: z.object({
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .email({ message: "Invalid email address" }),
    password: z.string().min(1, { message: "Password is required" }),
  }),
});
  
const createForgetPasswordZodSchema = z.object({
  body: z.object({
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .email({ message: "Invalid email address" }),
  }),
});
  
const createResetPasswordZodSchema = z.object({
  body: z.object({
    newPassword: z.string().min(1, { message: "Password is required" }),
    confirmPassword: z
      .string()
      .min(1, { message: "Confirm Password is required" }),
  }),
});
  
const createChangePasswordZodSchema = z.object({
  body: z.object({
    currentPassword: z
      .string()
      .min(1, { message: "Current Password is required" }),
    newPassword: z.string().min(1, { message: "New Password is required" }),
    confirmPassword: z
      .string()
      .min(1, { message: "Confirm Password is required" }),
  }),
});

const socialLoginZodSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, { message: "Firebase idToken is required" }),
    fcmToken: z.string().optional().nullable(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
});

const selectRoleZodSchema = z.object({
  body: z.object({
    role: z.nativeEnum(USER_ROLES),
  }),
});

export const AuthValidation = {
    createVerifyEmailZodSchema,
    createForgetPasswordZodSchema,
    createLoginZodSchema,
    createResetPasswordZodSchema,
    createChangePasswordZodSchema,
    socialLoginZodSchema,
    selectRoleZodSchema,
};
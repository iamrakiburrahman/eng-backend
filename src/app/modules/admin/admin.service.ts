import { StatusCodes } from 'http-status-codes';
import { IUser } from '../user/user.interface';
import { User } from '../user/user.model';
import { USER_ROLES } from '../../../enums/user';
import ApiError from '../../../errors/ApiErrors';
import bcrypt from 'bcrypt';
import config from '../../../config';

import crypto from 'crypto';
import { emailHelper } from '../../../helpers/emailHelper';
import { emailTemplate } from '../../../shared/emailTemplate';
import { logger, errorLogger } from '../../../shared/logger';

const generateRandomPassword = (): string => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
  let randomPart = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    randomPart += chars[bytes[i] % chars.length];
  }
  return `Eng@${randomPart}`;
};

const createAdminToDB = async (payload: any): Promise<IUser> => {
  const isExist = await User.findOne({ email: payload.email });
  if (isExist) {
    throw new ApiError(StatusCodes.CONFLICT, 'An account with this email already exists');
  }

  // Auto-generate password if omitted
  const rawPassword =
    payload.password && payload.password.trim()
      ? payload.password.trim()
      : generateRandomPassword();

  // Derive userName if missing
  const userName =
    payload.userName ||
    (payload.firstName && payload.lastName
      ? `${payload.firstName}_${payload.lastName}`.toLowerCase().replace(/\s+/g, '_')
      : payload.name || payload.email.split('@')[0]);

  const adminData = {
    ...payload,
    password: rawPassword,
    userName,
    role: USER_ROLES.ADMIN,
    verified: true,
    status: 'APPROVED',
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
  };

  const createAdmin = await User.create(adminData);
  if (!createAdmin) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create Admin');
  }

  // Send credentials email to the new admin
  try {
    const adminFullName =
      `${createAdmin.firstName || ''} ${createAdmin.lastName || ''}`.trim() ||
      (createAdmin as any).name ||
      createAdmin.userName ||
      'Administrator';

    const emailData = emailTemplate.adminCredentials({
      name: adminFullName,
      email: createAdmin.email,
      password: rawPassword,
      role: 'ADMIN',
      permissions: createAdmin.permissions || [],
      loginUrl: 'https://dashboard.engsportsuk.com/auth/login',
    });

    await emailHelper.sendEmail(emailData);
    logger.info(`[Admin Management] Credentials email sent successfully to ${createAdmin.email}`);
  } catch (emailError) {
    errorLogger.error(`[Admin Management] Failed to send credentials email to ${createAdmin.email}:`, emailError);
  }

  return createAdmin;
};

const getAdminFromDB = async (): Promise<IUser[]> => {
  const admins = await User.find({ role: USER_ROLES.ADMIN })
    .select('firstName lastName name userName email phone profile location role permissions status createdAt updatedAt')
    .sort({ createdAt: -1 });
  return admins;
};

const getSingleAdminFromDB = async (id: string): Promise<IUser> => {
  const admin = await User.findOne({ _id: id, role: USER_ROLES.ADMIN })
    .select('firstName lastName name userName email phone profile location role permissions status createdAt updatedAt');
  if (!admin) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin not found');
  }
  return admin;
};

const updateAdminToDB = async (id: string, payload: any): Promise<IUser> => {
  const isExistAdmin = await User.findById(id);
  if (!isExistAdmin) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin not found');
  }

  // Cannot modify SUPER_ADMIN through this endpoint
  if (isExistAdmin.role === USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cannot modify Super Admin account');
  }

  // If email is changing, check uniqueness
  if (payload.email && payload.email !== isExistAdmin.email) {
    const emailExist = await User.findOne({ email: payload.email, _id: { $ne: id } });
    if (emailExist) {
      throw new ApiError(StatusCodes.CONFLICT, 'Email is already in use by another user');
    }
  }

  // Handle password update if provided
  if (payload.password && payload.password.trim().length >= 6) {
    payload.password = await bcrypt.hash(
      payload.password.trim(),
      Number(config.bcrypt_salt_rounds) || 12
    );
  } else {
    delete payload.password;
  }

  // Make sure role cannot be escalated to SUPER_ADMIN here
  delete payload.role;

  if (payload.permissions !== undefined && !Array.isArray(payload.permissions)) {
    payload.permissions = [];
  }

  const updatedAdmin = await User.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  }).select('firstName lastName name userName email phone profile location role permissions status createdAt updatedAt');

  if (!updatedAdmin) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update Admin');
  }

  return updatedAdmin;
};

const deleteAdminFromDB = async (id: string): Promise<IUser> => {
  const isExistAdmin = await User.findById(id);
  if (!isExistAdmin) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin not found');
  }

  if (isExistAdmin.role === USER_ROLES.SUPER_ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cannot delete Super Admin account');
  }

  const deleted = await User.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to delete Admin');
  }
  return deleted;
};

export const AdminService = {
  createAdminToDB,
  getAdminFromDB,
  getSingleAdminFromDB,
  updateAdminToDB,
  deleteAdminFromDB,
};

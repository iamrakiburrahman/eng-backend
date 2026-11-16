import { Model, Types } from 'mongoose';
import { USER_ROLES } from '../../../enums/user';

export enum AGE_GROUP {
  U16 = "U16",
  U18 = "U18",
  U21 = "U21",
  SENIOR = "SENIOR",
}

export enum SELECT_GROUP {
  A = "A",
  B = "B",
  C = "C",
}

interface IStripeAccountInfo {
    status: string;
    stripeAccountId: string;
    externalAccountId: string;
    currency: string;
}

interface IAuthenticationProps {
    isResetPassword: boolean;
    oneTimeCode: number;
    expireAt: Date;
}

export type IUser = {
    userName: string;
    appId: string;
    role: USER_ROLES;
    email: string;
    password: string;
    rewardPoint: number;
    fcmToken: string;
    location: string;
    profile: string;
    verified: boolean;
    authProvider?: string;
    firebaseUid?: string;
    authentication?: IAuthenticationProps;
    accountInformation?: IStripeAccountInfo;

    // UserDetails properties
    firstName?: string;
    lastName?: string;
    dateOfBirth?: Date;
    strongFoot?: string;
    ageGroup?: string;
    selectTeam?: Types.ObjectId;
    position?: string;
    document?: string[];
    phone?: string;
    status?: "PENDING" | "APPROVED" | "REJECTED";
    engCoine?: number;
    marketValue?: number;
    debutDate?: Date;
    blueTick?: boolean;
    playForAcademy?: boolean;
    academyClubName?: string;
    isDevelopmentPlayer?: boolean;
    mediaConsent?: boolean;
    parentId?: Types.ObjectId;
    previousClub?: string;
    rejectionReason?: string;
    emergencyEmail?: string;
    emergencyPhone?: string;
    jerseyNumber?: string;
    isSubscribed?: boolean;
    hasAccess?: boolean;
    permissions?: string[];
    isLiveTransferListed?: boolean;
    liveTransferListingId?: Types.ObjectId;
}

export type UserModal = {
    isExistUserById(id: string): any;
    isExistUserByEmail(email: string): any;
    isAccountCreated(id: string): any;
    isMatchPassword(password: string, hashPassword: string): boolean;
} & Model<IUser>;
import { model, Schema } from "mongoose";
import { USER_ROLES } from "../../../enums/user";
import { IUser, UserModal } from "./user.interface";
import bcrypt from "bcrypt";
import config from "../../../config";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";

const userSchema = new Schema<IUser, UserModal>(
  {
    userName: {
      type: String,
      required: false,
    },
    appId: {
      type: String,
      required: false,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    email: {
      type: String,
      required: false,
      unique: true,
      lowercase: true,
      sparse: true, // ✅ allow multiple null-safe behavior
    },
    password: {
      type: String,
      required: false,
      select: 0,
      minlength: 8,
    },
    rewardPoint: {
      type: Number,
      required:false
    },
    fcmToken: {
      type: String,
    default: null,
    },
    location: {
      type: String,
      required: false,
    },
    profile: {
      type: String,
      default:
        "https://res.cloudinary.com/dzo4husae/image/upload/v1733459922/zfyfbvwgfgshmahyvfyk.png",
    },
    verified: {
      type: Boolean,
      default: false,
    },
    authProvider: {
      type: String,
      default: "email",
    },
    firebaseUid: {
      type: String,
      default: null,
      sparse: true,
    },
    authentication: {
      type: {
        isResetPassword: {
          type: Boolean,
          default: false,
        },
        oneTimeCode: {
          type: Number,
          default: null,
        },
        expireAt: {
          type: Date,
          default: null,
        },
      },
      select: 0,
    },
    accountInformation: {
      status: {
        type: Boolean,
        default: false,
      },
      stripeAccountId: String,
      externalAccountId: String,
      currency: String,
    },
    // UserDetails properties
    firstName: {
      type: String,
      required: false,
      trim: true,
    },
    lastName: {
      type: String,
      required: false,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      required: false,
    },
    ageGroup: {
      type: String,
      required: false,
    },
    selectTeam: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: false,
    },
    strongFoot: {
      type: String,
      default: null,
    },
    position: {
      type: String,
      default: null,
    },
    jerseyNumber: {
      type: String,
      default: null,
    },
    document: {
      type: [String],
      default: []
    },
    phone: {
      type: String,
      required: false,
    },
    engCoine: {
      type: Number,
      default: 0,
    },
    marketValue: {
      type: Number,
      default: 0,
    },
    debutDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    blueTick: {
      type: Boolean,
      default: false,
    },
    playForAcademy: {
      type: Boolean,
      default: false,
    },
    academyClubName: {
      type: String,
      default: "",
    },
    isDevelopmentPlayer: {
      type: Boolean,
      default: false,
    },
    mediaConsent: {
      type: Boolean,
      default: false,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    previousClub: {
      type: String,
      default: "",
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    emergencyEmail: {
      type: String,
      default: "",
    },
    emergencyPhone: {
      type: String,
      default: "",
    },
    isSubscribed: {
      type: Boolean,
      default: false,
    },
    hasAccess: {
      type: Boolean,
      default: false,
    },
    permissions: {
      type: [String],
      default: [],
    },
    isLiveTransferListed: {
      type: Boolean,
      default: false,
      index: true,
    },
    liveTransferListingId: {
      type: Schema.Types.ObjectId,
      ref: 'LiveTransferMarket',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ parentId: 1, role: 1 });
userSchema.index({ status: 1 });

//
// ✅ STATIC METHODS
//
userSchema.statics.isExistUserById = async function (id: string) {
  return await this.findById(id);
};

userSchema.statics.isExistUserByEmail = async function (email: string) {
  return await this.findOne({ email });
};

userSchema.statics.isAccountCreated = async function (id: string) {
  const user: any = await this.findById(id);
  return user?.accountInformation?.status || false;
};

userSchema.statics.isMatchPassword = async function (
  password: string,
  hashPassword: string
): Promise<boolean> {
  return await bcrypt.compare(password, hashPassword);
};

//
// ❌ IMPORTANT FIX: NO DB QUERY inside pre-save
// ❌ removed duplicate email check (handled by unique index)
//
userSchema.pre("save", async function () {
  if (this.isModified("password") && this.password) {
    this.password = await bcrypt.hash(
      this.password,
      Number(config.bcrypt_salt_rounds)
    );
  }

  // 💰 Dynamic Market Value calculation using conversionRate from PlayerEconomy (only if marketValue not explicitly modified)
  if (this.isModified("engCoine") && !this.isModified("marketValue")) {
    const pe = await PlayerEconomy.findOne();
    const rate = pe?.conversionRate ?? 10;
    this.marketValue = (this.engCoine || 0) * rate;
  }
});

export const User = model<IUser, UserModal>("User", userSchema);
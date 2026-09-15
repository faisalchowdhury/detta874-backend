import mongoose, { Schema } from "mongoose";
import { IUser, IOTP, MoodEnum } from "./user.interface";
import { ERole } from "../../config/role";

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, trim: true, required: false, default: null },
    username: {
      type: String,
      trim: true,
      unique: true,
      required: true,
    },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, trim: true },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
      required: false,
      default: null,
    },
    ageRange: { type: String, trim: true, default: null },
    address: { type: String, trim: true, default: null },
    user_mood: {
      type: String,
      enum: MoodEnum,
      required: true,
      default: "null",
    },
    jurnals: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Jurnals",
      required: false,
      default: [],
    },
    chat_history_with_ai: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "aichats",
      required: false,
      default: [],
    },
    profile_status: {
      type: Boolean,
      required: true,
      default: false,
    },
    blockStatus: {
      type: Date,
      required: false,
      default: null,
    },
    conections: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "friends",
      required: false,
      default: [],
    },
    image: {
      type: {
        publicFileURL: { type: String, trim: true },
        path: { type: String, trim: true },
      },
      required: false,
      default: {
        publicFileURL: "",
        path: "",
      },
    },
    role: {
      type: String,
      enum: ERole,
      required: true,
      default: "user",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    fcmToken: { type: String, trim: true },
    isRequest: {
      type: String,
      enum: ["approve", "deny", "send"],
      default: "send",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    activeStatus: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: true },
);

export const UserModel =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

UserSchema.index({ name: "text" });
UserSchema.index({ createdAt: 1 });
UserModel.schema.index({ role: 1 });

const OTPSchema = new Schema<IOTP>({
  email: { type: String, required: true, trim: true, index: true },
  otp: { type: String, required: true, trim: true },
  expiresAt: { type: Date, required: true, index: { expires: "1m" } },
});

export const OTPModel = mongoose.model<IOTP>("OTP", OTPSchema);
OTPSchema.index({ email: 1, expiresAt: 1 });

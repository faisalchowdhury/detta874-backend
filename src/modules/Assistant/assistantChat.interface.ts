import { Types } from "mongoose";

export type TAssistantChat = {
  user: Types.ObjectId;
  type: "me" | "assistant";
  message: string;
  // Supplied by `{ timestamps: true }` on the schema; declared so the
  // conversation window can order and stamp turns without casting.
  createdAt?: Date;
  updatedAt?: Date;
};

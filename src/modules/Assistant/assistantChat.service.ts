import mongoose from "mongoose";
import { logger } from "../../logger/logger";
import { AssistantChats } from "./assistantChat.model";
import { CompanionService } from "./companion.service";
import { AssistantStyleService } from "./assistantStyle.service";

/**
 * Accepts one user message for the Companion.
 *
 * The message is persisted before anything else so the conversation window can
 * always be rebuilt from Mongo (spec section 11, steps 2-3). Reply generation
 * then runs in the background and streams over the socket, which is why the
 * HTTP response does not wait for it - the endpoint contract is unchanged.
 */
const sendAssistantMessage = async (
  myMessage: string,
  userId: string,
  user_name: string,
) => {
  const userMessage = await AssistantChats.create({
    user: new mongoose.Types.ObjectId(userId),
    type: "me",
    message: myMessage,
  });

  // Style adaptation is derived from the raw user message; it adds no model
  // call, so it costs the response path nothing (spec section 4).
  void AssistantStyleService.observeUserMessage(userId, myMessage);

  void CompanionService.companionReply({
    userId,
    userName: user_name,
    textPrompt: myMessage,
    userMessageId: userMessage?._id,
  }).catch((err) =>
    logger.error(`companionReply failed for user ${userId}`, err),
  );

  return userMessage;
};

const getMyAssistantConversations = async (
  userId: string,
  limit: number,
  skip: number,
) => {
  // Find all assistant chats for the user, sorted by most recent
  const chats = await AssistantChats.find({ user: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .exec();

  return chats;
};

export const AssistantChatServices = {
  sendAssistantMessage,
  getMyAssistantConversations,
};

import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AssistantChatServices } from "./assistantChat.service";
import ApiError from "../../errors/ApiError";
import { IUserPayload } from "../../middlewares/roleGuard";
import paginationBuilder from "../../utils/paginationBuilder";
import { AssistantChats } from "./assistantChat.model";

const sendAssistantMessage = catchAsync(async (req: Request, res: Response) => {
  const myMessage = req.body?.me;
  const userId = (req.user as IUserPayload)?.id; // Use type assertion to access id
  const user_name = (req.user as IUserPayload)?.name; // Use type assertion to access id
  if (!myMessage) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Your message is required");
  }
  if (!userId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User ID is required");
  }
  await AssistantChatServices.sendAssistantMessage(
    myMessage,
    userId,
    user_name,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Message sent successfully!",
    data: myMessage,
  });
});

const getMyAssistantConversations = catchAsync(
  async (req: Request, res: Response) => {
    const userId = (req.user as IUserPayload)?.id;
    const page = parseInt(req.query?.page as string) || 1;
    const limit = parseInt(req.query?.limit as string) || 10;
    const skip = (page - 1) * limit;
    if (!userId) {
      throw new ApiError(httpStatus.BAD_REQUEST, "User ID is required");
    }
    const data = await AssistantChatServices.getMyAssistantConversations(
      userId,
      limit,
      skip
    );
    const totalData = await AssistantChats.countDocuments({ user: userId });
    const pagination = paginationBuilder({
      totalData: totalData,
      currentPage: page,
      limit,
    });

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Assistant conversations fetched successfully!",
      data: { chat: data?.reverse(), pagination },
    });
  }
);

export const AssistantChatControllers = {
  sendAssistantMessage,
  getMyAssistantConversations,
};

import path from "path";
// Import the 'express' module
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, NextFunction, Request, Response } from "express";
import globalErrorHandler from "./middlewares/globalErrorHandler";
import notFound from "./middlewares/notFound";

import router from "./routes";
import { logger, logHttpRequests } from "./logger/logger";

import { template } from "./rootTemplate";
import { sendPushNotificationToMultiple } from "./modules/notifications/pushNotification/pushNotification.controller";

// Create an Express application
const app: Application = express();
app.use(logHttpRequests);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const allowedOrigins = [
  "https://dashboard-heirloom.netlify.app",
  "http://localhost:5173", // add your dev origin(s)
  "http://187.124.231.5",
  "https://dashboard-heirloom.netlify.app",
];
app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser tools (curl/postman) with no origin
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

app.use(express.static("public"));

//application router
app.use(router);

// Define a route for the root path ('/')
app.get("/", (req: Request, res: Response) => {
  logger.info("Root endpoint hit 🌐 :");
  res.status(200).send(template);
});
// sendPushNotificationToMultiple(
//   [
//     "fA4WZu0szE5ahtKB7WeYoq:APA91bEpOElf8jdIcVCMlNvlShD6ba921IbaTtJZJya5v4-8-YJ4qcQrEB4wcu3NVppnJ689xJKk55xLIdgi9I8Zyacgpcc1uM7YukF2kq5IMrZqkOkklpQ",
//   ],
//   {
//     body: "Test push notification body",
//     title: "Test Notification",
//   }
// )
//   .then(() => {
//     console.log("resolved");
//   })
//   .catch((error) => {
//     console.log(error);
//   });

app.all("*", notFound);
app.use(globalErrorHandler);

// Log errors
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Error occurred: ${err.message}`, { stack: err.stack });
  next(err);
});

export default app;

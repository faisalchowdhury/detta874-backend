import { createServer, Server as HttpServer } from "http";
import { initSocketIO } from "./utils/socket";
import mongoose from "mongoose";
import app from "./app"; // Express app
import { DATABASE_URL, PORT } from "./config";
import seedSuperAdmin, { seedAbout, seedPrivacy, seedTerms } from "./DB"; // Seeding function

let server: HttpServer;
import dns from "dns";
// Google DNS
// dns.setServers(["8.8.8.8", "8.8.4.4"]);

// Cloudflare DNS
dns.setServers(["1.1.1.1", "1.0.0.1"]);
async function main() {
  try {
    const dbStartTime = Date.now();
    const loadingFrames = ["🌍", "🌎", "🌏"]; // Loader animation frames
    let frameIndex = 0;

    // Start the connecting animation
    const loader = setInterval(() => {
      process.stdout.write(
        `\rMongoDB connecting ${loadingFrames[frameIndex]} Please wait 😢`,
      );
      frameIndex = (frameIndex + 1) % loadingFrames.length;
    }, 300); // Update frame every 300ms

    // Connect to MongoDB with a timeout
    await mongoose.connect(DATABASE_URL as string, {
      connectTimeoutMS: 10000, // 10 seconds timeout
    });

    // Stop the connecting animation
    clearInterval(loader);
    console.log(
      `\r✅ Mongodb connected successfully in ${Date.now() - dbStartTime}ms`,
    );

    // Start HTTP server
    server = createServer(app);
    // Start the server and log the time taken
    const serverStartTime = Date.now();
    server.listen(PORT, () => {
      console.log(
        `🚀 Server is running on port ${PORT} and took ${Date.now() - serverStartTime}ms to start`,
      );
    });

    // Initialize Socket.IO
    initSocketIO(server);

    // Start seeding in parallel after the server has started
    await Promise.all([
      seedSuperAdmin(),
      seedPrivacy(),
      seedTerms(),
      seedAbout(),
    ]);
  } catch (error) {
    console.error("Error in main function:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("☠️ Unhandled error in main:", error);
  process.exit(1);
});

// Gracefully handle unhandled rejections and uncaught exceptions
process.on("unhandledRejection", (err) => {
  console.error(" ☠️ Unhandled promise rejection detected:", err);
  server.close(() => process.exit(1));
});

process.on("uncaughtException", (error) => {
  console.error("☠️ Uncaught exception detected:", error);
  server.close(() => process.exit(1));
});

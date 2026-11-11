import dns from "dns";
import app from "./app";
import config from "./config";
import { errorLogger, logger } from "./shared/logger";
import colors from "colors";
import {
  connectServices,
  initSocketServer,
  gracefulShutdown,
} from "./helpers/serverLifecycle";

// Set DNS servers to resolve SRV records for MongoDB Atlas if local DNS fails
// dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

let server: any;

async function bootstrap() {
  try {
    // 1. Connect core database and cache services
    await connectServices();

    // 2. Start HTTP server
    const port =
      typeof config.port === "number" ? config.port : Number(config.port);
    const ipAddress = (config.ip_address as string) || "0.0.0.0";
    await new Promise<void>((resolve, reject) => {
      server = app.listen(port, ipAddress, () => {
        logger.info(
          colors.yellow(
            `♻️  Application listening on http://${ipAddress}:${port}`,
          ),
        );
        resolve();
      });
      server.once("error", reject);
    });

    // 3. Initialize Socket Server
    await initSocketServer(server);

    // 4. Signal PM2 cluster readiness for zero-downtime start/reload
    if (typeof process.send === "function") {
      process.send("ready");
    }
  } catch (error) {
    errorLogger.error(colors.red("💥 Server bootstrap failed:"), error);
    process.exit(1);
  }
}

bootstrap();

// ==========================================
// PROCESS EXCEPTION & SIGNAL EVENT HANDLERS
// ==========================================
process.on("uncaughtException", (error) => {
  errorLogger.error("uncaughtException Detected:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  errorLogger.error("UnhandledRejection Detected:", error);
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
process.on("SIGINT", () => gracefulShutdown("SIGINT", server));

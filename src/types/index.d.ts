import { JwtPayload } from "jsonwebtoken";
import { Server } from "socket.io";

declare global {
  var io: Server;
  namespace Express {
    interface Request {
      user?: JwtPayload | null;
    }
  }
}

declare module "helmet" {
  import { RequestHandler } from "express";

  interface HelmetOptions {
    crossOriginResourcePolicy?: { policy?: string };
    contentSecurityPolicy?: boolean | Record<string, any>;
    [key: string]: any;
  }

  function helmet(options?: HelmetOptions): RequestHandler;
  export default helmet;
}
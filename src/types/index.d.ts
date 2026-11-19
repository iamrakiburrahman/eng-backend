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

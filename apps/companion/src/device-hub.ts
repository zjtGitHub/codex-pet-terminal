import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { ApprovalDecision, ApprovalRequest, DeviceOutboundMessage, PetState } from "./types.js";

const inboundSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approval.decision"),
    requestId: z.string().min(1),
    decision: z.enum(["accept", "decline"]),
  }),
  z.object({
    type: z.literal("pet.touch"),
    gesture: z.enum(["tap", "pet", "poke"]).optional(),
  }),
  z.object({
    type: z.literal("device.hello"),
    name: z.string().optional(),
    version: z.string().optional(),
  }),
]);

export class DeviceHub {
  private readonly deviceWss = new WebSocketServer({ noServer: true });
  private readonly uiWss = new WebSocketServer({ noServer: true });
  private lastState: PetState;
  private lastApproval?: ApprovalRequest;

  onDecision?: (requestId: string, decision: ApprovalDecision) => void;
  onTouch?: (gesture: "tap" | "pet" | "poke") => void;

  constructor(
    initialState: PetState,
    private readonly token: string,
    private readonly codexConnected: () => boolean,
  ) {
    this.lastState = initialState;
    this.deviceWss.on("connection", (socket) => this.attach(socket));
    this.uiWss.on("connection", (socket) => this.attach(socket));
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url || "/", "http://localhost");

    if (url.pathname === "/ws-device") {
      if (url.searchParams.get("token") !== this.token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return true;
      }
      this.deviceWss.handleUpgrade(request, socket, head, (ws) => {
        this.deviceWss.emit("connection", ws, request);
      });
      return true;
    }

    if (url.pathname === "/ws-ui") {
      const remote = request.socket.remoteAddress || "";
      if (!isLoopback(remote)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return true;
      }
      this.uiWss.handleUpgrade(request, socket, head, (ws) => {
        this.uiWss.emit("connection", ws, request);
      });
      return true;
    }

    return false;
  }

  broadcastState(state: PetState): void {
    this.lastState = state;
    this.broadcast({ type: "state", payload: state });
  }

  broadcastApproval(approval: ApprovalRequest): void {
    this.lastApproval = approval;
    this.broadcast({ type: "approval.request", payload: approval });
  }

  broadcastApprovalResolved(requestId: string, decision: ApprovalDecision): void {
    if (this.lastApproval?.requestId === requestId) this.lastApproval = undefined;
    this.broadcast({ type: "approval.resolved", payload: { requestId, decision } });
  }

  broadcastReaction(reaction: string, message: string): void {
    this.broadcast({ type: "pet.reaction", payload: { reaction, message } });
  }

  broadcastSystem(): void {
    this.broadcast({
      type: "system",
      payload: {
        codexConnected: this.codexConnected(),
        deviceCount: this.deviceWss.clients.size,
        uiCount: this.uiWss.clients.size,
      },
    });
  }

  private attach(socket: WebSocket): void {
    this.send(socket, { type: "state", payload: this.lastState });
    if (this.lastApproval) this.send(socket, { type: "approval.request", payload: this.lastApproval });
    this.broadcastSystem();

    socket.on("message", (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = inboundSchema.safeParse(json);
      if (!parsed.success) return;

      if (parsed.data.type === "approval.decision") {
        this.onDecision?.(parsed.data.requestId, parsed.data.decision);
      } else if (parsed.data.type === "pet.touch") {
        this.onTouch?.(parsed.data.gesture ?? "tap");
      }
    });

    socket.on("close", () => this.broadcastSystem());
  }

  private broadcast(message: DeviceOutboundMessage): void {
    for (const socket of [...this.deviceWss.clients, ...this.uiWss.clients]) {
      this.send(socket, message);
    }
  }

  private send(socket: WebSocket, message: DeviceOutboundMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

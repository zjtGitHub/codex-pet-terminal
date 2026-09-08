import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { CodexBridge } from "./codex-bridge.js";
import { DeviceHub } from "./device-hub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const deviceToken = process.env.DEVICE_TOKEN || "codex-pet-dev";

const app = express();
const server = http.createServer(app);
const bridge = new CodexBridge();
const hub = new DeviceHub(bridge.getState(), deviceToken, () => bridge.isConnected());

app.use(express.json({ limit: "256kb" }));
app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, codexConnected: bridge.isConnected(), state: bridge.getState().state });
});

app.use("/api", localOnly);

app.get("/api/status", (_req, res) => {
  res.json({ codexConnected: bridge.isConnected(), state: bridge.getState() });
});

app.post("/api/codex/connect", async (_req, res) => {
  try {
    await bridge.start();
    res.json({ ok: true, state: bridge.getState() });
  } catch (error) {
    res.status(500).json({ ok: false, error: errorMessage(error) });
  }
});

app.post("/api/codex/thread", async (req, res) => {
  const parsed = z.object({ cwd: z.string().min(1).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const threadId = await bridge.startThread(parsed.data.cwd);
    res.json({ threadId });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

app.post("/api/codex/turn", async (req, res) => {
  const parsed = z
    .object({
      threadId: z.string().min(1),
      text: z.string().min(1),
      cwd: z.string().min(1).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const turnId = await bridge.startTurn(parsed.data.threadId, parsed.data.text, parsed.data.cwd);
    res.json({ turnId });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

app.post("/api/mock/approval", (_req, res) => {
  const approval = bridge.injectMockApproval();
  res.json(approval);
});

bridge.on("state", (state) => hub.broadcastState(state));
bridge.on("approval", (approval) => hub.broadcastApproval(approval));
bridge.on("approvalResolved", ({ requestId, decision }) => {
  hub.broadcastApprovalResolved(requestId, decision);
});
bridge.on("connected", () => hub.broadcastSystem());
bridge.on("log", ({ stream, text }) => console.log(`[codex:${stream}] ${text}`));

hub.onDecision = (requestId, decision) => {
  // Mock approvals are only UI exercises and do not have a live app-server request.
  if (requestId.startsWith("mock:")) {
    hub.broadcastApprovalResolved(requestId, decision);
    return;
  }
  const resolved = bridge.resolveApproval(requestId, decision);
  if (!resolved) console.warn(`Ignoring unknown approval request: ${requestId}`);
};

hub.onTouch = (gesture) => {
  const reactions = {
    tap: ["blink", "Hey!"],
    pet: ["happy", "That feels nice."],
    poke: ["surprised", "What was that?!"],
  } as const;
  const [reaction, message] = reactions[gesture];
  hub.broadcastReaction(reaction, message);
};

server.on("upgrade", (request, socket, head) => {
  if (!hub.handleUpgrade(request, socket, head)) socket.destroy();
});

server.listen(port, host, async () => {
  console.log(`Codex Pet Companion: http://127.0.0.1:${port}`);
  console.log(`ESP32 WebSocket: ws://<mac-ip>:${port}/ws-device?token=<DEVICE_TOKEN>`);
  if (deviceToken === "codex-pet-dev") {
    console.warn("WARNING: using development DEVICE_TOKEN. Set DEVICE_TOKEN before using on a shared LAN.");
  }

  try {
    await bridge.start();
  } catch (error) {
    console.warn(`Codex app-server not connected yet: ${errorMessage(error)}`);
    console.warn("The simulator still works. Install/login to Codex, then POST /api/codex/connect or restart.");
  }
});

process.on("SIGINT", () => {
  bridge.stop();
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  bridge.stop();
  server.close(() => process.exit(0));
});

function localOnly(req: Request, res: Response, next: NextFunction) {
  const address = req.socket.remoteAddress || "";
  if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return next();
  res.status(403).json({ error: "Localhost only" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

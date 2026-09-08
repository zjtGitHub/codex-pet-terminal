import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { ApprovalDecision, ApprovalRequest, PetState } from "./types.js";

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export class CodexBridge extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<JsonRpcId, PendingRpc>();
  private approvals = new Map<string, { rpcId: JsonRpcId; method: string }>();
  private connected = false;
  private currentState: PetState = {
    state: "offline",
    message: "Codex app-server is not connected",
    updatedAt: Date.now(),
  };

  constructor(
    private readonly codexBin = process.env.CODEX_BIN || "codex",
    private readonly defaultCwd = process.env.CODEX_CWD || process.cwd(),
  ) {
    super();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getState(): PetState {
    return this.currentState;
  }

  async start(): Promise<void> {
    if (this.child) return;

    const child = spawn(this.codexBin, ["app-server", "--stdio"], {
      cwd: this.defaultCwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.on("error", (error) => {
      this.connected = false;
      this.setState("offline", `Failed to start Codex: ${error.message}`);
      this.rejectAll(error);
    });

    child.on("exit", (code, signal) => {
      this.connected = false;
      this.child = undefined;
      this.setState(
        "offline",
        `Codex app-server exited (${code ?? "no code"}${signal ? `, ${signal}` : ""})`,
      );
      this.rejectAll(new Error("Codex app-server exited"));
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.emit("log", { stream: "stderr", text });
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    await this.rpc("initialize", {
      clientInfo: {
        name: "codex-pet-terminal",
        title: "Codex Pet Terminal",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized", {});
    this.connected = true;
    this.setState("idle", "Codex is ready");
    this.emit("connected");
  }

  stop(): void {
    this.child?.kill("SIGTERM");
  }

  async startThread(cwd = this.defaultCwd): Promise<string> {
    this.assertConnected();
    const response = (await this.rpc("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      serviceName: "codex-pet-terminal",
      threadSource: "user",
      sessionStartSource: "startup",
    })) as { thread?: { id?: string } };

    const threadId = response?.thread?.id;
    if (!threadId) throw new Error("thread/start returned no thread id");
    return threadId;
  }

  async startTurn(threadId: string, text: string, cwd?: string): Promise<string> {
    this.assertConnected();
    const response = (await this.rpc("turn/start", {
      threadId,
      input: [{ type: "text", text, textElements: [] }],
      ...(cwd ? { cwd } : {}),
      approvalPolicy: "on-request",
    })) as { turn?: { id?: string } };

    const turnId = response?.turn?.id;
    if (!turnId) throw new Error("turn/start returned no turn id");
    return turnId;
  }

  resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
    const pending = this.approvals.get(requestId);
    if (!pending) return false;

    this.write({ id: pending.rpcId, result: { decision } });
    this.approvals.delete(requestId);
    this.emit("approvalResolved", { requestId, decision });
    this.setState("coding", decision === "accept" ? "Approved — Codex continues" : "Declined — Codex is replanning");
    return true;
  }

  injectMockApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
    const rpcId = `mock-${Date.now()}`;
    const requestId = `mock:${rpcId}`;
    const approval: ApprovalRequest = {
      requestId,
      rpcId,
      method: "mock/requestApproval",
      kind: "command",
      command: "npm install @example/sdk",
      cwd: this.defaultCwd,
      reason: "Mock approval used to test the pet terminal UI",
      threadId: "mock-thread",
      turnId: "mock-turn",
      itemId: "mock-item",
      startedAtMs: Date.now(),
      ...overrides,
    };
    this.emitApproval(approval, false);
    return approval;
  }

  private async rpc(method: string, params?: JsonObject): Promise<unknown> {
    const id = this.nextId++;
    this.write({ id, method, ...(params ? { params } : {}) });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private notify(method: string, params?: JsonObject): void {
    this.write({ method, ...(params ? { params } : {}) });
  }

  private write(message: JsonObject): void {
    if (!this.child?.stdin.writable) {
      throw new Error("Codex app-server stdin is not writable");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("log", { stream: "stdout", text: line });
      return;
    }

    if (message && "id" in message && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message && "id" in message && typeof message.method === "string") {
      this.handleServerRequest(message);
      return;
    }

    if (typeof message?.method === "string") {
      this.handleNotification(message.method, message.params ?? {});
    }
  }

  private handleServerRequest(message: { id: JsonRpcId; method: string; params?: any }): void {
    const params = message.params ?? {};
    if (
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval"
    ) {
      const kind = message.method.includes("commandExecution") ? "command" : "fileChange";
      const requestId = `${kind}:${String(message.id)}`;
      const approval: ApprovalRequest = {
        requestId,
        rpcId: message.id,
        method: message.method,
        kind,
        command: params.command ?? null,
        cwd: params.cwd ?? null,
        reason: params.reason ?? null,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        startedAtMs: params.startedAtMs,
      };
      this.approvals.set(requestId, { rpcId: message.id, method: message.method });
      this.emitApproval(approval, true);
      return;
    }

    // Fail closed. An unknown server request must never be implicitly approved.
    this.write({
      id: message.id,
      error: {
        code: -32601,
        message: `Unsupported Codex server request: ${message.method}`,
      },
    });
  }

  private handleNotification(method: string, params: any): void {
    this.emit("notification", { method, params });

    if (method === "turn/started") {
      this.setState("thinking", "Codex is thinking", params.threadId, params.turn?.id);
      return;
    }

    if (method === "item/started" || method === "item/updated") {
      const itemType = params.item?.type ?? params.itemType;
      if (itemType === "commandExecution" || itemType === "fileChange" || itemType === "mcpToolCall") {
        this.setState("coding", this.itemMessage(itemType), params.threadId, params.turnId, itemType);
      } else if (itemType === "reasoning") {
        this.setState("thinking", "Codex is reasoning", params.threadId, params.turnId, itemType);
      }
      return;
    }

    if (method === "turn/completed") {
      const status = params.turn?.status;
      if (status === "completed") {
        this.setState("done", "Task completed", params.threadId, params.turn?.id);
      } else {
        this.setState("error", `Turn ${status ?? "failed"}`, params.threadId, params.turn?.id);
      }
      return;
    }

    if (method === "error") {
      this.setState("error", params.message || params.error?.message || "Codex reported an error");
    }
  }

  private emitApproval(approval: ApprovalRequest, live: boolean): void {
    this.setState("approval", approval.reason || "Codex needs approval", approval.threadId, approval.turnId);
    this.emit("approval", { ...approval, live });
  }

  private setState(
    state: PetState["state"],
    message: string,
    threadId?: string,
    turnId?: string,
    itemType?: string,
  ): void {
    this.currentState = {
      state,
      message,
      threadId,
      turnId,
      itemType,
      updatedAt: Date.now(),
    };
    this.emit("state", this.currentState);
  }

  private itemMessage(itemType: string): string {
    switch (itemType) {
      case "commandExecution":
        return "Codex is running a command";
      case "fileChange":
        return "Codex is editing files";
      case "mcpToolCall":
        return "Codex is using a tool";
      default:
        return "Codex is working";
    }
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error("Codex app-server is not connected");
  }
}

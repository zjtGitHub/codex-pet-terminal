export type PetStateName =
  | "offline"
  | "idle"
  | "thinking"
  | "coding"
  | "approval"
  | "done"
  | "error";

export type PetState = {
  state: PetStateName;
  message: string;
  threadId?: string;
  turnId?: string;
  itemType?: string;
  updatedAt: number;
};

export type ApprovalDecision = "accept" | "decline";

export type ApprovalRequest = {
  requestId: string;
  rpcId: string | number;
  method: string;
  kind: "command" | "fileChange" | "unknown";
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  startedAtMs?: number;
};

export type DeviceInboundMessage =
  | {
      type: "approval.decision";
      requestId: string;
      decision: ApprovalDecision;
    }
  | {
      type: "pet.touch";
      gesture?: "tap" | "pet" | "poke";
    }
  | {
      type: "device.hello";
      name?: string;
      version?: string;
    };

export type DeviceOutboundMessage =
  | { type: "state"; payload: PetState }
  | { type: "approval.request"; payload: ApprovalRequest }
  | {
      type: "approval.resolved";
      payload: { requestId: string; decision: ApprovalDecision };
    }
  | { type: "pet.reaction"; payload: { reaction: string; message: string } }
  | {
      type: "system";
      payload: { codexConnected: boolean; deviceCount: number; uiCount: number };
    };

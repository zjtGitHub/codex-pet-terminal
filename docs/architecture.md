# Architecture

## Components

### 1. Codex app-server

The Companion launches a dedicated `codex app-server --stdio` process and talks to it using line-delimited JSON messages over stdin/stdout.

The Companion performs:

1. `initialize`
2. `initialized`
3. `thread/start`
4. `turn/start`
5. consumes notifications and server-initiated approval requests
6. answers approval requests using the original JSON-RPC request id

### 2. Mac Companion

Responsibilities:

- process lifecycle
- JSON-RPC request/response correlation
- mapping Codex events to a small pet state machine
- holding pending approval requests
- WebSocket fan-out to local UI and physical devices
- accepting only explicit `accept` / `decline` decisions from the device

### 3. Pet state machine

```text
offline -> idle -> thinking -> coding -> approval
                     ^          |          |
                     |          +----------+
                     |
                     +------ done / error
```

This is intentionally small. Display animation is a presentation concern and should not leak into the Codex bridge.

### 4. ESP32-S3 terminal

Responsibilities:

- Wi-Fi connection
- authenticated WebSocket connection to the Companion
- render current pet state
- render approval details
- send Accept / Decline
- send touch gestures

The firmware does not store Codex credentials and does not call OpenAI directly.

## Important integration boundary

The MVP creates and controls threads through its own app-server process. It is not a passive mirror of a separate Codex Desktop process. If Codex Desktop later supports attaching to a user-provided app-server endpoint, the architecture can converge so the Desktop UI and pet terminal are clients of the same backend.

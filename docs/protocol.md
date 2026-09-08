# Device WebSocket protocol

Endpoint:

```text
ws://<mac-lan-ip>:8787/ws-device?token=<DEVICE_TOKEN>
```

Messages are UTF-8 JSON.

## Companion -> device

### State

```json
{
  "type": "state",
  "payload": {
    "state": "coding",
    "message": "Codex is editing files",
    "threadId": "...",
    "turnId": "...",
    "updatedAt": 1788860000000
  }
}
```

States:

- `offline`
- `idle`
- `thinking`
- `coding`
- `approval`
- `done`
- `error`

### Approval request

```json
{
  "type": "approval.request",
  "payload": {
    "requestId": "command:42",
    "kind": "command",
    "command": "npm install foo",
    "cwd": "/Users/me/project",
    "reason": "network access required"
  }
}
```

### Approval resolved

```json
{
  "type": "approval.resolved",
  "payload": {
    "requestId": "command:42",
    "decision": "accept"
  }
}
```

### Pet reaction

```json
{
  "type": "pet.reaction",
  "payload": {
    "reaction": "happy",
    "message": "That feels nice."
  }
}
```

## Device -> Companion

### Device hello

```json
{
  "type": "device.hello",
  "name": "esp32-s3-pet",
  "version": "0.1.0"
}
```

### Approval decision

```json
{
  "type": "approval.decision",
  "requestId": "command:42",
  "decision": "accept"
}
```

Only `accept` and `decline` are accepted by the MVP.

### Pet touch

```json
{
  "type": "pet.touch",
  "gesture": "pet"
}
```

Gestures: `tap`, `pet`, `poke`.

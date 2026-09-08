# Codex Pet Terminal 🐾

A physical desktop companion for Codex: a tiny ESP32-S3 terminal that turns agent state into a pet, surfaces approval requests, and lets you approve or decline them with physical controls.

> **MVP scope:** the Companion owns a `codex app-server` process and can control Codex threads started through that process. It does **not** intercept approval dialogs from an unrelated already-running Codex Desktop session.

## What works in v0.1

- Mac-side Node/TypeScript Companion
- launches `codex app-server --stdio`
- performs the app-server initialize handshake
- creates Codex threads and turns
- listens for Codex state notifications
- receives command/file-change approval requests
- never auto-approves unknown requests (fail closed)
- broadcasts state and approvals over WebSocket
- local browser simulator with a pet UI
- mock approval button for testing without running a task
- ESP32-S3 firmware skeleton
- two physical buttons: Accept / Decline
- Wi-Fi WebSocket protocol shared by browser simulator and hardware
- display abstraction ready for a TFT/touch driver

## Architecture

```text
                     localhost only
  Browser simulator <--------------+
                                   |
                                   v
+----------------------+      +------------------------+
| codex app-server     |<---->| Mac Companion          |
| stdin/stdout JSON-RPC|      | Node + TypeScript      |
+----------------------+      +-----------+------------+
                                          |
                                          | WebSocket + token
                                          v
                              +------------------------+
                              | ESP32-S3 Pet Terminal  |
                              | screen / touch/buttons |
                              +------------------------+
```

## Why app-server instead of keyboard automation?

Codex exposes structured approval callbacks. A command approval contains useful context such as the command, cwd, reason, thread, turn, and item identifiers. The Companion can answer the same JSON-RPC request with an explicit approval decision, so the physical button is a real Codex client action rather than a simulated `Y` keypress.

## Run the Mac simulator

Requirements:

- Node.js 20+
- Codex CLI installed and logged in (`codex` available in your shell)

```bash
cp .env.example .env
# edit DEVICE_TOKEN before using on a shared network
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:8787
```

The browser UI is deliberately localhost-only for actions that can approve Codex operations.

### Test without touching a real project

1. Start the Companion.
2. Open the local simulator.
3. Click **模拟授权请求**.
4. The pet enters the approval state.
5. Press **允许** or **拒绝**.

### Run a real Codex turn through the Companion

1. Click **连接 Codex app-server** if it is not connected.
2. Enter an absolute working directory.
3. Click **新建 Thread**.
4. Enter a task.
5. Click **运行任务**.
6. When Codex requests approval, the browser and ESP32 receive the same approval event.

## ESP32-S3

The first firmware build intentionally supports a plain ESP32-S3 DevKit before a specific screen is chosen.

```bash
cd firmware/esp32-s3
cp include/secrets.example.h include/secrets.h
# edit Wi-Fi, Mac IP, DEVICE_TOKEN
pio run -t upload
pio device monitor
```

Default buttons:

- GPIO 4 -> Accept
- GPIO 5 -> Decline

The current `DisplayPort` is a Serial stub. The networking/approval layer is already separated from rendering so a board-specific touch display can be added next.

## Recommended display direction

For the physical build, use an ESP32-S3 display board or an SPI screen with:

- 240×240 or 320×240 TFT
- ST7789 or GC9A01 display controller
- CST816S / FT6336 / similar capacitive touch controller
- PSRAM strongly preferred for sprite animation

Once the exact screen is selected, implement `DisplayPort` with LVGL or LovyanGFX/TFT_eSPI and map touch regions to pet gestures.

## Safety model

A physical approval button is powerful. The MVP follows these rules:

- no automatic approval
- unknown Codex server requests fail closed
- only `accept` and `decline` are exposed on hardware
- browser control API is localhost-only
- ESP32 WebSocket requires `DEVICE_TOKEN`
- approval screen shows command/reason/cwd when available

Do not expose the Companion port to the public internet.

## Project layout

```text
apps/companion/          Mac-side Codex bridge + browser simulator
firmware/esp32-s3/       PlatformIO ESP32-S3 firmware
docs/architecture.md     architecture and lifecycle
docs/protocol.md         device WebSocket protocol
docs/roadmap.md          staged implementation plan
```

## Next milestone

**v0.2 — real pet screen**

- choose a concrete ESP32-S3 touch-display board
- sprite sheet / animation state machine
- touch pet / poke / drag interactions
- approval overlay with command preview
- large physical rotary button: press = accept, long-press = decline
- idle animations and task-complete celebration

## License

MIT

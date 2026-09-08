# ESP32-S3 firmware

The MVP firmware deliberately targets a plain `esp32-s3-devkitc-1` so the networking and approval path can be tested before choosing a screen.

## Wiring

- GPIO 4 -> momentary button -> GND: **Accept**
- GPIO 5 -> momentary button -> GND: **Decline**
- USB-C -> power/programming

Copy `include/secrets.example.h` to `include/secrets.h`, enter Wi-Fi, Mac LAN IP, and the same `DEVICE_TOKEN` used by the companion.

```bash
pio run -t upload
pio device monitor
```

The current `DisplayPort` writes to Serial. The next hardware commit should replace it with a board-specific TFT/touch implementation without changing the WebSocket protocol or approval logic.

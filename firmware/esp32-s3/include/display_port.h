#pragma once
#include <Arduino.h>

struct ApprovalView {
  String requestId;
  String command;
  String cwd;
  String reason;
};

// Hardware-independent display boundary.
// MVP uses Serial so it builds on a plain ESP32-S3 DevKit.
// Add a board-specific implementation later (ST7789/GC9A01 + CST816/FT6336, etc.).
class DisplayPort {
 public:
  void begin();
  void renderState(const String& state, const String& message);
  void renderApproval(const ApprovalView& approval);
  void clearApproval();
  void react(const String& reaction, const String& message);
};

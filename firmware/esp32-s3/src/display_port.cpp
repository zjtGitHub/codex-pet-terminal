#include "display_port.h"

void DisplayPort::begin() {
  Serial.println("[display] stub ready");
}

void DisplayPort::renderState(const String& state, const String& message) {
  Serial.printf("[pet] state=%s message=%s\n", state.c_str(), message.c_str());
}

void DisplayPort::renderApproval(const ApprovalView& approval) {
  Serial.println("\n=== CODEX APPROVAL ===");
  Serial.printf("reason: %s\n", approval.reason.c_str());
  Serial.printf("command: %s\n", approval.command.c_str());
  Serial.printf("cwd: %s\n", approval.cwd.c_str());
  Serial.println("BTN_ACCEPT -> accept | BTN_DECLINE -> decline");
  Serial.println("======================\n");
}

void DisplayPort::clearApproval() {
  Serial.println("[display] approval cleared");
}

void DisplayPort::react(const String& reaction, const String& message) {
  Serial.printf("[pet] reaction=%s message=%s\n", reaction.c_str(), message.c_str());
}

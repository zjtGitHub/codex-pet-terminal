#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

#include "display_port.h"
#include "secrets.h"

constexpr uint8_t PIN_ACCEPT = 4;
constexpr uint8_t PIN_DECLINE = 5;
constexpr unsigned long DEBOUNCE_MS = 250;

WebSocketsClient ws;
DisplayPort display;
ApprovalView pendingApproval;
bool hasPendingApproval = false;
unsigned long lastAcceptMs = 0;
unsigned long lastDeclineMs = 0;

void sendJson(JsonDocument& doc) {
  String payload;
  serializeJson(doc, payload);
  ws.sendTXT(payload);
}

void sendHello() {
  JsonDocument doc;
  doc["type"] = "device.hello";
  doc["name"] = "esp32-s3-pet";
  doc["version"] = "0.1.0";
  sendJson(doc);
}

void sendDecision(const char* decision) {
  if (!hasPendingApproval) return;
  JsonDocument doc;
  doc["type"] = "approval.decision";
  doc["requestId"] = pendingApproval.requestId;
  doc["decision"] = decision;
  sendJson(doc);
}

void sendPetTouch(const char* gesture = "pet") {
  JsonDocument doc;
  doc["type"] = "pet.touch";
  doc["gesture"] = gesture;
  sendJson(doc);
}

void handleMessage(const uint8_t* payload, size_t length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[ws] bad json: %s\n", error.c_str());
    return;
  }

  const char* type = doc["type"] | "";
  if (strcmp(type, "state") == 0) {
    String state = doc["payload"]["state"] | "idle";
    String message = doc["payload"]["message"] | "";
    display.renderState(state, message);
    return;
  }

  if (strcmp(type, "approval.request") == 0) {
    pendingApproval.requestId = String((const char*)(doc["payload"]["requestId"] | ""));
    pendingApproval.command = String((const char*)(doc["payload"]["command"] | ""));
    pendingApproval.cwd = String((const char*)(doc["payload"]["cwd"] | ""));
    pendingApproval.reason = String((const char*)(doc["payload"]["reason"] | "Codex needs approval"));
    hasPendingApproval = pendingApproval.requestId.length() > 0;
    display.renderApproval(pendingApproval);
    return;
  }

  if (strcmp(type, "approval.resolved") == 0) {
    const char* requestId = doc["payload"]["requestId"] | "";
    if (hasPendingApproval && pendingApproval.requestId == requestId) {
      hasPendingApproval = false;
      display.clearApproval();
    }
    return;
  }

  if (strcmp(type, "pet.reaction") == 0) {
    display.react(
      String((const char*)(doc["payload"]["reaction"] | "blink")),
      String((const char*)(doc["payload"]["message"] | ""))
    );
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[ws] connected");
      sendHello();
      break;
    case WStype_DISCONNECTED:
      Serial.println("[ws] disconnected");
      display.renderState("offline", "Companion disconnected");
      break;
    case WStype_TEXT:
      handleMessage(payload, length);
      break;
    default:
      break;
  }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Connecting to Wi-Fi: %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print('.');
  }
  Serial.printf("\nWi-Fi ready: %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(PIN_ACCEPT, INPUT_PULLUP);
  pinMode(PIN_DECLINE, INPUT_PULLUP);
  display.begin();
  display.renderState("offline", "Connecting to Wi-Fi");
  connectWifi();

  String path = String("/ws-device?token=") + DEVICE_TOKEN;
  ws.begin(COMPANION_HOST, COMPANION_PORT, path.c_str());
  ws.onEvent(webSocketEvent);
  ws.setReconnectInterval(2500);
  display.renderState("idle", "Waiting for Companion");
}

void loop() {
  ws.loop();
  const unsigned long now = millis();

  if (digitalRead(PIN_ACCEPT) == LOW && now - lastAcceptMs > DEBOUNCE_MS) {
    lastAcceptMs = now;
    sendDecision("accept");
  }

  if (digitalRead(PIN_DECLINE) == LOW && now - lastDeclineMs > DEBOUNCE_MS) {
    lastDeclineMs = now;
    sendDecision("decline");
  }

  // Temporary interaction gesture for a plain DevKit: hold both buttons.
  // A real touchscreen driver will call sendPetTouch() from its touch region.
  if (digitalRead(PIN_ACCEPT) == LOW && digitalRead(PIN_DECLINE) == LOW) {
    sendPetTouch("pet");
    delay(500);
  }
}

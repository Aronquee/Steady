#include "NetworkManager.h"
#include "Config.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <ESPAsyncWebServer.h>

static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");
static QueueHandle_t s_commandQueue = nullptr;

// Minimal text protocol on the same WS connection as the binary sample
// stream: "start_recording", "stop_recording", or "set_task:<name>".
static void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                       AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("[WS] client #%u connected\n", client->id());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[WS] client #%u disconnected\n", client->id());
  } else if (type == WS_EVT_DATA && s_commandQueue != nullptr) {
    String msg;
    for (size_t i = 0; i < len; i++) msg += (char)data[i];

    RemoteCommand cmd{};
    if (msg == "start_recording") {
      cmd.type = RemoteCommandType::START_RECORDING;
      xQueueSend(s_commandQueue, &cmd, 0);
    } else if (msg == "stop_recording") {
      cmd.type = RemoteCommandType::STOP_RECORDING;
      xQueueSend(s_commandQueue, &cmd, 0);
    } else if (msg.startsWith("set_task:")) {
      cmd.type = RemoteCommandType::SET_TASK;
      String task = msg.substring(strlen("set_task:"));
      task.toCharArray(cmd.task, sizeof(cmd.task));
      xQueueSend(s_commandQueue, &cmd, 0);
    }
  }
}

bool SteadyNetworkManager::begin(QueueHandle_t commandQueueOut) {
  s_commandQueue = commandQueueOut;

  // ---- Print MAC address ----
  Serial.print("[Net] ESP MAC: ");
  Serial.println(WiFi.macAddress());

  // ---- Try STA mode first ----
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.setSleep(false);
  Serial.print("[Net] Trying STA");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_STA_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    _isStation = true;
    Serial.print("[Net] STA connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    // ---- Diagnostic: print failure reason ----
    wl_status_t status = WiFi.status();
    Serial.print("[Net] STA failed, status: ");
    switch (status) {
      case WL_NO_SSID_AVAIL:
        Serial.println("WL_NO_SSID_AVAIL - SSID not found (check name)");
        break;
      case WL_CONNECT_FAILED:
        Serial.println("WL_CONNECT_FAILED - Connection failed (check password)");
        break;
      case WL_DISCONNECTED:
        Serial.println("WL_DISCONNECTED - Disconnected during attempt (check password / security / MAC filter)");
        break;
      case WL_IDLE_STATUS:
        Serial.println("WL_IDLE_STATUS - Idle (timeout?)");
        break;
      default:
        Serial.println(status);
        break;
    }

    // ---- Full radio reset and AP fallback ----
    Serial.println("[Net] Falling back to AP");
    WiFi.disconnect(true);
    delay(200);
    WiFi.mode(WIFI_OFF);
    delay(300);
    WiFi.mode(WIFI_AP);
    delay(100);

    // ---- Boost TX power to maximum ----
    WiFi.setTxPower(WIFI_POWER_19_5dBm);

    // ---- Try channel 1 (often clearer than 6) ----
    bool ap_ok = WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD, 1);

    if (!ap_ok) {
      Serial.println("[Net] ERROR: softAP failed to start!");
    } else {
      _isStation = false;
      Serial.print("[Net] AP IP: ");
      Serial.println(WiFi.softAPIP());
      Serial.print("[Net] AP MAC: ");
      Serial.println(WiFi.softAPmacAddress());
      // Channel print removed because softAPgetChannel() not available.
    }
  }

  // ---- mDNS ----
  if (!MDNS.begin(MDNS_HOSTNAME)) {
    Serial.println("[Net] mDNS init failed (device still reachable by IP)");
  } else {
    Serial.printf("[Net] mDNS up: http://%s.local\n", MDNS_HOSTNAME);
  }

  // ---- WebSocket & server ----
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.begin();

  // ---- Debug: send a text message every 2 seconds to verify WebSocket works ----
  static uint32_t lastPing = 0;
  if (millis() - lastPing > 2000) {
    ws.textAll("Ping from ESP");
    lastPing = millis();
  }

  return true;
}


String SteadyNetworkManager::currentAddressHint() const {
  if (_isStation) {
    return String(MDNS_HOSTNAME) + ".local (or " + WiFi.localIP().toString() + ")";
  }
  return String("SSID: ") + WIFI_AP_SSID + " -> " + WiFi.softAPIP().toString();
}

void SteadyNetworkManager::sendTestMessage() {
  static uint32_t last = 0;
  if (millis() - last > 2000) {
    if (ws.count() > 0) {
      ws.textAll("Ping");
      Serial.println("[Net] Sent test text message");
    }
    last = millis();
  }
}

// ---- Binary sample streaming ----
void SteadyNetworkManager::streamSample(const ProcessedData &data) {
  //if (!_recording || ws.count() == 0) return;
  if (ws.count() == 0) return;

  uint8_t buf[28];
  memcpy(buf,      &data.timestamp_ms, 4);
  memcpy(buf + 4,  &data.raw_ax, 4);
  memcpy(buf + 8,  &data.raw_ay, 4);
  memcpy(buf + 12, &data.raw_az, 4);
  memcpy(buf + 16, &data.fx, 4);
  memcpy(buf + 20, &data.fy, 4);
  memcpy(buf + 24, &data.fz, 4);
  ws.binaryAll(buf, sizeof(buf));
}


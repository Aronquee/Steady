// =====================================================================
// STEADY - Firmware Skeleton (Clinical Refactor)
// ESP32-S3-Touch-LCD-1.69 + onboard QMI8658
// Architecture:
//   Core 0: sensor acquisition + DSP (fixed rate)
//   Core 1: display + WiFi/WebSocket
// =====================================================================

#include "Config.h"
#include "TremorSensor.h"
#include "QMI8658Sensor.h"
#include "DSPPipeline.h"
#include "DisplayManager.h"
#include "NetworkManager.h"

// ---------------- Shared objects ----------------
QMI8658Sensor sensor;
TremorPipeline pipeline;
DisplayManager display;
SteadyNetworkManager network;

// ---------------- Global state ----------------
volatile bool recording = false;
String currentTask = "Rest";
uint32_t sessionStartMs = 0;

// ---------------- Inter-core plumbing ----------------
struct ProcessedDataEvent {
  ProcessedData data;
};
static QueueHandle_t dataQueue;
static QueueHandle_t remoteCommandQueue;

// =====================================================================
//  NOVO: envio do pacote binário pela USB Serial
//  Formato: 4 bytes (timestamp uint32_t) + 6 floats (24 bytes) = 28 bytes
// =====================================================================
void sendSerialPacket(const ProcessedData& data) {
  uint8_t packet[28];
  uint32_t ts = millis();  // ou um contador incremental, se preferir
  memcpy(packet, &ts, 4);
  float vals[6] = {
    data.ax, data.ay, data.az,
    data.fx, data.fy, data.fz
  };
  memcpy(packet + 4, vals, 24);
  Serial.write(packet, 28);
}

// ---------------- Core 0 task: acquisition + DSP ----------------
void sensorTask(void *pvParameters) {
  const TickType_t period = pdMS_TO_TICKS(1000 / SAMPLE_RATE_HZ);
  TickType_t lastWake = xTaskGetTickCount();

  for (;;) {
    IMUSample sample;
    if (sensor.readSample(sample)) {
      ProcessedData data = pipeline.process(sample);
      
      // Envia para a fila (UI/WebSocket)
      ProcessedDataEvent evt{data};
      xQueueSend(dataQueue, &evt, 0);

      // NOVO: envia o mesmo pacote pela USB Serial
      sendSerialPacket(data);
    }
    vTaskDelayUntil(&lastWake, period);
  }
}

// ---------------- Core 1 task: UI + network ----------------
void uiNetworkTask(void *pvParameters) {
  uint32_t lastDisplayUpdate = 0;
  const uint32_t DISPLAY_UPDATE_MS = 40;   // 25 Hz

  for (;;) {
    // ---- Handle remote commands ----
    RemoteCommand cmd;
    while (xQueueReceive(remoteCommandQueue, &cmd, 0) == pdTRUE) {
      switch (cmd.type) {
        case RemoteCommandType::START_RECORDING:
          recording = true;
          sessionStartMs = millis();
          network.setRecording(true);
          break;
        case RemoteCommandType::STOP_RECORDING:
          recording = false;
          network.setRecording(false);
          break;
        case RemoteCommandType::SET_TASK:
          currentTask = String(cmd.task);
          network.setTask(currentTask);
          break;
      }
    }

    // ---- Drain data events ----
    ProcessedDataEvent evt;
    while (xQueueReceive(dataQueue, &evt, 0) == pdTRUE) {
      // Always stream to network at full rate
      network.streamSample(evt.data);

      // Update display only if enough time has passed
      uint32_t now = millis();
      if (now - lastDisplayUpdate >= DISPLAY_UPDATE_MS) {
        uint32_t elapsed = recording ? (now - sessionStartMs) / 1000 : 0;
        display.updateDisplay(evt.data, recording, elapsed, currentTask);
        lastDisplayUpdate = now;
      }
    }

    network.sendTestMessage();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(41, OUTPUT);
  digitalWrite(41, HIGH);
  delay(200);
  Serial.println("\n[Steady] boot");

  if (!sensor.begin()) {
    Serial.println("[Steady] FATAL: sensor init failed");
  }
  pipeline.begin(sensor.getSampleRateHz());

  if (!display.begin()) {
    Serial.println("[Steady] FATAL: display init failed");
  }

  dataQueue = xQueueCreate(128, sizeof(ProcessedDataEvent));
  remoteCommandQueue = xQueueCreate(8, sizeof(RemoteCommand));

  if (!network.begin(remoteCommandQueue)) {
    Serial.println("[Steady] WARNING: network init failed, running offline");
  } else {
    Serial.println("[Steady] Reachable at: " + network.currentAddressHint());
  }

  xTaskCreatePinnedToCore(sensorTask, "sensorTask", 4096, nullptr, 2, nullptr, 0);
  xTaskCreatePinnedToCore(uiNetworkTask, "uiNetworkTask", 8192, nullptr, 1, nullptr, 1);

  Serial.println("[Steady] Monitoring started.");
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}

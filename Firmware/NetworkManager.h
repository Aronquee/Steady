#pragma once
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "DSPPipeline.h"


// Commands the PC frontend can send over the WebSocket control channel.
// These only toggle recording/task state on the device — the ESP never
// interprets the signal itself, it just gates the binary stream.
enum class RemoteCommandType { START_RECORDING, STOP_RECORDING, SET_TASK };

struct RemoteCommand {
  RemoteCommandType type;
  char task[16];  // populated only when type == SET_TASK
};

class SteadyNetworkManager {
 public:
  // queue is provided by the caller (created in the .ino) so incoming
  // WS commands can be safely handed off to whichever task owns the
  // recording/task state, since the WebSocket callback runs in its own
  // context (AsyncTCP), not in our sensor/UI task.
  bool begin(QueueHandle_t commandQueueOut);

  // Packs and sends one 28-byte binary frame (see roadmap sec 1.3) to
  // all connected clients. No-op if not recording or nobody's
  // connected — this is the only thing sent at sample rate.
  static constexpr size_t SN_MAX_BATCH = 16;

  // Packs and sends one 28-byte binary frame (see roadmap sec 1.3) to
  // all connected clients. No-op if not recording or nobody's
  // connected — this is the only thing sent at sample rate.
  void streamSample(const ProcessedData &data);

  // Batched version: packs up to SN_MAX_BATCH samples (28 bytes each,
  // back-to-back) into ONE WebSocket binary frame instead of one frame
  // per sample. Cuts 802.11 airtime overhead at high sample rates.
  // ⚠️ Changes the wire format — the PC-side WS client must be updated
  // to split each incoming frame into 28-byte chunks.
  void streamBatch(const ProcessedData *data, size_t count);
  void setRecording(bool state) { _recording = state; }
  bool isRecording() const { return _recording; }

  void setTask(const String &task) { _task = task; }
  String currentTask() const { return _task; }

  bool isConnectedAsStation() const { return _isStation; }
  String currentAddressHint() const;  // e.g. "steady.local" or AP IP
  void sendTestMessage(); 
 private:
  bool _isStation = false;
  bool _recording = false;
  String _task = "Rest";
};

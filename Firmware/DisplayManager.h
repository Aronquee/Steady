#pragma once
#include <Arduino.h>
#include "DSPPipeline.h"   // for ProcessedData

class DisplayManager {
 public:
  bool begin();
  void updateDisplay(const ProcessedData &data,
                     bool recording,
                     uint32_t elapsedSeconds,
                     const String &task);

 private:
  static const int WAVEFORM_POINTS = 240;
  float _waveformX[WAVEFORM_POINTS];
  float _waveformY[WAVEFORM_POINTS];
  float _waveformZ[WAVEFORM_POINTS];
  int _writeIndex = 0;
  bool _initialized = false;

  void drawWaveform();
  void drawStatusBar(bool recording, uint32_t elapsedSeconds, const String &task);
  void drawEnvelopeBar(float envelope);
};
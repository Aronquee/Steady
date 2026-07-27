#pragma once
#include <Arduino.h>
#include "TremorSensor.h"
#include "Config.h"

// ---------------------------------------------------------------------
// Generic biquad (2nd order IIR) section.
// ---------------------------------------------------------------------
class Biquad {
 public:
  void setCoefficients(float b0, float b1, float b2, float a1, float a2);
  float process(float x);
  void reset();

 private:
  float _b0 = 1, _b1 = 0, _b2 = 0, _a1 = 0, _a2 = 0;
  float _z1 = 0, _z2 = 0;
};

// Cascade of biquad sections (Direct Form II Transposed, SOS style).
class BiquadCascade {
 public:
  void loadFromConfig(const BiquadCoeffs *sections, int count);
  float process(float x);
  void reset();

 private:
  static const int MAX_SECTIONS = 8;
  Biquad _sections[MAX_SECTIONS];
  int _count = 0;
};

// One sample's worth of processed data.
struct ProcessedData {
    uint32_t timestamp_ms;
    float raw_ax, raw_ay, raw_az;
    float fx, fy, fz;        // bandpass-filtered per axis
    float local_envelope;    // for TFT amplitude bar only
};

// Bandpass filter + envelope for display. No thresholds, no FFT.
class TremorPipeline {
 public:
  void begin(float sampleRateHz);
  ProcessedData process(const IMUSample &sample);
  void reset();

 private:
  float _sampleRateHz = SAMPLE_RATE_HZ;
  BiquadCascade _bpX, _bpY, _bpZ;
  float _envelopeState = 0.0f;
  float _envelopeAlpha = 0.0f;
};
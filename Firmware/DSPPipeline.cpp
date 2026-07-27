#include "DSPPipeline.h"
#include "Config.h"
#include <math.h>

// ---------------- Biquad ----------------
void Biquad::setCoefficients(float b0, float b1, float b2, float a1, float a2) {
  _b0 = b0; _b1 = b1; _b2 = b2; _a1 = a1; _a2 = a2;
}

float Biquad::process(float x) {
  float y = _b0 * x + _z1;
  _z1 = _b1 * x - _a1 * y + _z2;
  _z2 = _b2 * x - _a2 * y;
  return y;
}

void Biquad::reset() { _z1 = 0; _z2 = 0; }

// ---------------- BiquadCascade ----------------
void BiquadCascade::loadFromConfig(const BiquadCoeffs *sections, int count) {
  _count = (count > MAX_SECTIONS) ? MAX_SECTIONS : count;
  for (int i = 0; i < _count; i++) {
    _sections[i].setCoefficients(sections[i].b0, sections[i].b1,
                                  sections[i].b2, sections[i].a1,
                                  sections[i].a2);
  }
}

float BiquadCascade::process(float x) {
  float y = x;
  for (int i = 0; i < _count; i++) {
    y = _sections[i].process(y);
  }
  return y;
}

void BiquadCascade::reset() {
  for (int i = 0; i < _count; i++) _sections[i].reset();
}

// ---------------- TremorPipeline ----------------
void TremorPipeline::begin(float sampleRateHz) {
  _sampleRateHz = sampleRateHz;

  static const int kNumSections =
      sizeof(BANDPASS_SOS) / sizeof(BANDPASS_SOS[0]);
  _bpX.loadFromConfig(BANDPASS_SOS, kNumSections);
  _bpY.loadFromConfig(BANDPASS_SOS, kNumSections);
  _bpZ.loadFromConfig(BANDPASS_SOS, kNumSections);

  float dt = 1.0f / _sampleRateHz;
  float tau = ENVELOPE_TIME_CONST_MS / 1000.0f;
  _envelopeAlpha = dt / (tau + dt);

  reset();
}

void TremorPipeline::reset() {
  _bpX.reset();
  _bpY.reset();
  _bpZ.reset();
  _envelopeState = 0.0f;
}

ProcessedData TremorPipeline::process(const IMUSample &sample) {
  ProcessedData out;
  out.timestamp_ms = sample.timestamp_ms;
  out.raw_ax = sample.ax;
  out.raw_ay = sample.ay;
  out.raw_az = sample.az;

  out.fx = _bpX.process(sample.ax);
  out.fy = _bpY.process(sample.ay);
  out.fz = _bpZ.process(sample.az);

  float mag = sqrtf(out.fx * out.fx + out.fy * out.fy + out.fz * out.fz);
  _envelopeState += _envelopeAlpha * (mag - _envelopeState);
  out.local_envelope = _envelopeState;

  return out;
}
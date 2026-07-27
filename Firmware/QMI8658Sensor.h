#pragma once
#include "TremorSensor.h"

class QMI8658Sensor : public ITremorSensor {
 public:
  bool begin() override;
  bool readSample(IMUSample &out) override;
  float getSampleRateHz() const override { return _sampleRateHz; }

 private:
  float _sampleRateHz = 0.0f;
  bool _ready = false;
};

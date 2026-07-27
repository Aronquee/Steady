#pragma once
#include <Arduino.h>

// A single raw IMU reading. Kept identical regardless of which physical
// sensor produced it, so the DSP pipeline never needs to know whether
// the data came from the onboard QMI8658 or (later) the BNO085.
struct IMUSample {
  float ax, ay, az;   // g
  float gx, gy, gz;   // deg/s (unused by current pipeline, reserved)
  uint32_t timestamp_ms;
};

// Abstract interface every physical sensor driver implements.
// Swapping QMI8658 -> BNO085 later means writing one new .cpp file
// that implements this interface — nothing else changes.
class ITremorSensor {
 public:
  virtual ~ITremorSensor() {}
  virtual bool begin() = 0;
  virtual bool readSample(IMUSample &out) = 0;   // true if a new sample was read
  virtual float getSampleRateHz() const = 0;
};

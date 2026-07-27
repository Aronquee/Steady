#include "QMI8658Sensor.h"
#include "Config.h"
#include <Wire.h>

// TODO: confirm this include/class name against your installed SensorLib
// version. As of recent SensorLib releases this is typically:
//   #include <SensorQMI8658.hpp>
//   SensorQMI8658 qmi;
// Older/newer versions may differ slightly (e.g. namespacing, config
// struct names). This file is the ONLY place that should need edits if
// so — the rest of the firmware talks to ITremorSensor, not to SensorLib.
#include <SensorQMI8658.hpp>

static SensorQMI8658 qmi;

bool QMI8658Sensor::begin() {
  Wire.begin(PIN_IMU_SDA, PIN_IMU_SCL);

  if (!qmi.begin(Wire, QMI8658_I2C_ADDR, PIN_IMU_SDA, PIN_IMU_SCL)) {
    Serial.println("[QMI8658] init failed - check wiring/address");
    _ready = false;
    return false;
  }

  // Configure accelerometer: full-scale and output data rate.
  // Confirm enum names against installed SensorLib version.
  qmi.configAccelerometer(
      SensorQMI8658::ACC_RANGE_4G,
      SensorQMI8658::ACC_ODR_1000Hz,
      SensorQMI8658::LPF_MODE_0);

  // NOTE: the QMI8658 gyroscope has no discrete 1000Hz ODR option — its
  // available rates are 7174.4/3587.2/1793.6/896.8/448.4/224.2/112.1/
  // 56.05/28.025 Hz. We pick the nearest one below our needs; this is
  // independent of SAMPLE_RATE_HZ (the rate at which sensorTask polls
  // and the pipeline processes), which only requires the chip's ODR to
  // be >= our polling rate so fresh data is always available.
  qmi.configGyroscope(
      SensorQMI8658::GYR_RANGE_256DPS,
      SensorQMI8658::GYR_ODR_896_8Hz,
      SensorQMI8658::LPF_MODE_3);

  qmi.enableAccelerometer();
  qmi.enableGyroscope();

  _sampleRateHz = SAMPLE_RATE_HZ;  // pipeline reads at this fixed rate
  _ready = true;
  return true;
}

bool QMI8658Sensor::readSample(IMUSample &out) {
  if (!_ready) return false;

  if (!qmi.getDataReady()) return false;

  float ax, ay, az, gx, gy, gz;
  qmi.getAccelerometer(ax, ay, az);
  qmi.getGyroscope(gx, gy, gz);

  out.ax = ax;
  out.ay = ay;
  out.az = az;
  out.gx = gx;
  out.gy = gy;
  out.gz = gz;
  out.timestamp_ms = millis();
  return true;
}

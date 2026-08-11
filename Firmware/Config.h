#pragma once
#include <Arduino.h>

// =====================================================================
// ESP32-S3-Touch-LCD-1.69 (onboard QMI8658 now, Planned to change into BNO085 later)
// =====================================================================
//
// IMPORTANT: pin numbers below are set to ESP32-S3-LCD-1.69.
// Before implementing this please checkout your pin config.
// It's usefull to look up into board examples so you can copy the file.
// Wiring the wrong pin on this board can damage it — do not guess. (low chance but can happen)
// =====================================================================

// ---------------- Display (ST7789V2, 4-wire SPI) ----------------
#define TFT_WIDTH        240
#define TFT_HEIGHT       280
#define PIN_TFT_CS       5
#define PIN_TFT_DC       4
#define PIN_TFT_RST      8
#define PIN_TFT_SCK      6
#define PIN_TFT_MOSI     7
#define PIN_TFT_BL       15

// ---------------- Touch (CST816T) + shared I2C bus -----------------
#define PIN_I2C_SDA      11
#define PIN_I2C_SCL      10
#define PIN_TOUCH_RST    13
#define PIN_TOUCH_INT    14

// ---------------- IMU (QMI8658C) -----------------------------------
#define PIN_IMU_SDA      PIN_I2C_SDA
#define PIN_IMU_SCL      PIN_I2C_SCL
#define QMI8658_I2C_ADDR 0x6B

// ---------------- Power management (AXP2101 PMU) --------------------
// This board manages the lithium battery via an AXP2101 PMU chip over
// I2C (XPOWERS_CHIP_AXP2101), NOT a raw ADC.
// Requires the XPowersLib (lewisxhe) — same author/style as SensorLib.
// Battery percentage/voltage/charging status are read via I2C calls,
// typically on the same shared bus above.
#define AXP2101_I2C_ADDR 0x34

// ---------------- Sampling / DSP -----------------------------------
// Clinical-refactor principle: the filter is fixed and always-on, but
// nothing on-device decides what the signal "means" — no thresholds,
// no episode detection. That interpretation now lives entirely in the
// offline PC analysis (see analysis_advanced.py, Phase 3).

#define SAMPLE_RATE_HZ          128
#define BANDPASS_LOW_HZ         3.0f
#define BANDPASS_HIGH_HZ        15.0f
#define ENVELOPE_TIME_CONST_MS  200   // smoothing for the on-screen amplitude bar ONLY —
                                       // not a clinical measurement, just keeps the bar readable

// Real Butterworth bandpass coefficients, scipy-validated:
// scipy.signal.butter(4, [3, 12], btype='band', fs=250, output='sos')
// This was validated offline against captures; no real tremor data was
// available yet, so re-check against real recordings before relying on
// the exact numbers clinically.
//
// Section count is implicit in the array size (see DSPPipeline.cpp,
// which uses sizeof(BANDPASS_SOS)/sizeof(BANDPASS_SOS[0])) so it can
// never drift out of sync with a separately-tracked count constant.
struct BiquadCoeffs { float b0, b1, b2, a1, a2; };
static const BiquadCoeffs BANDPASS_SOS[] = {
  {0.000712309f, 0.000000000f, -0.000712309f, -1.836984396f, 0.870179892f},
  {1.000000000f, 2.000000000f, 1.000000000f, -1.887593454f, 0.924283862f},
  {1.000000000f, -2.000000000f, 1.000000000f, -1.757560134f, 0.866086841f},
  {1.000000000f, -2.000000000f, 1.000000000f, -1.948504031f, 0.975382149f}
};

// ---------------- Networking -----------------------------------------
#define WIFI_STA_SSID        "Seu_Wifi"     // TODO fill in
#define WIFI_STA_PASSWORD    "Sua_Senha"     // TODO fill in
#define WIFI_STA_TIMEOUT_MS  15000
#define WIFI_AP_SSID         "Steady-Device"
#define WIFI_AP_PASSWORD     "steadyadmin"        // TODO choose something better
#define MDNS_HOSTNAME        "steady"           // -> http://steady.local

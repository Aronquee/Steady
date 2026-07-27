#include "DisplayManager.h"
#include "Config.h"
#include <Arduino_GFX_Library.h>
#include <Fonts/FreeSans9pt7b.h>

static Arduino_DataBus *bus = new Arduino_ESP32SPI(
    PIN_TFT_DC, PIN_TFT_CS, PIN_TFT_SCK, PIN_TFT_MOSI, -1);
static Arduino_GFX *gfx = new Arduino_ST7789(
    bus, PIN_TFT_RST, 0 /* rotation */, true /* IPS */,
    TFT_WIDTH, TFT_HEIGHT,
    0,   // offset_x
    20,  // offset_y
    0, 0);

#define COL_BG        RGB565(0, 0, 0)
#define COL_GRID      RGB565(30, 30, 30)
#define COL_TEXT      RGB565(240, 240, 240)
#define COL_REC       RGB565(255, 0, 0)
#define COL_FX        RGB565(255, 80, 80)   // red
#define COL_FY        RGB565(80, 255, 80)   // green
#define COL_FZ        RGB565(80, 160, 255)  // blue
#define COL_ENV_BG    RGB565(40, 40, 40)
#define COL_ENV_BAR   RGB565(200, 200, 50)

static void clearScreen() {
  gfx->fillScreen(COL_BG);
}

bool DisplayManager::begin() {
  if (PIN_TFT_BL >= 0) {
    pinMode(PIN_TFT_BL, OUTPUT);
    digitalWrite(PIN_TFT_BL, HIGH);
  }
  if (!gfx->begin()) {
    Serial.println("[Display] gfx->begin() failed");
    return false;
  }
  clearScreen();
  gfx->setFont(&FreeSans9pt7b);
  gfx->setTextColor(COL_TEXT);
  gfx->setCursor(20, 40);
  gfx->print("STEADY");
  gfx->setCursor(20, 70);
  gfx->print("Awaiting data...");
  delay(500);
  clearScreen();
  _initialized = false;
  return true;
}

void DisplayManager::updateDisplay(const ProcessedData &data,
                                   bool recording,
                                   uint32_t elapsedSeconds,
                                   const String &task) {
  if (!_initialized) {
    for (int i = 0; i < WAVEFORM_POINTS; i++) {
      _waveformX[i] = data.fx;
      _waveformY[i] = data.fy;
      _waveformZ[i] = data.fz;
    }
    _initialized = true;
  } else {
    _waveformX[_writeIndex] = data.fx;
    _waveformY[_writeIndex] = data.fy;
    _waveformZ[_writeIndex] = data.fz;
    _writeIndex = (_writeIndex + 1) % WAVEFORM_POINTS;
  }

  drawWaveform();
  drawStatusBar(recording, elapsedSeconds, task);
  drawEnvelopeBar(data.local_envelope);
}

void DisplayManager::drawWaveform() {
  gfx->fillRect(0, 0, TFT_WIDTH, 200, COL_BG);

  // Grid
  for (int x = 0; x < TFT_WIDTH; x += 20) {
    gfx->drawFastVLine(x, 0, 200, COL_GRID);
  }
  for (int y = 0; y < 200; y += 20) {
    gfx->drawFastHLine(0, y, TFT_WIDTH, COL_GRID);
  }

  auto mapValue = [](float v) -> int {
    const float maxAmp = 2.0f;
    if (v > maxAmp) v = maxAmp;
    if (v < -maxAmp) v = -maxAmp;
    return (int)((1.0f - (v + maxAmp) / (2.0f * maxAmp)) * 199);
  };

  for (int i = 0; i < WAVEFORM_POINTS - 1; i++) {
    int idx0 = (_writeIndex + i) % WAVEFORM_POINTS;
    int idx1 = (_writeIndex + i + 1) % WAVEFORM_POINTS;

    int x0 = i, x1 = i + 1;
    int y0x = mapValue(_waveformX[idx0]);
    int y1x = mapValue(_waveformX[idx1]);
    int y0y = mapValue(_waveformY[idx0]);
    int y1y = mapValue(_waveformY[idx1]);
    int y0z = mapValue(_waveformZ[idx0]);
    int y1z = mapValue(_waveformZ[idx1]);

    gfx->drawLine(x0, y0x, x1, y1x, COL_FX);
    gfx->drawLine(x0, y0y, x1, y1y, COL_FY);
    gfx->drawLine(x0, y0z, x1, y1z, COL_FZ);
  }
}

void DisplayManager::drawStatusBar(bool recording, uint32_t elapsedSeconds, const String &task) {
  gfx->fillRect(0, 200, TFT_WIDTH, 80, COL_BG);

  gfx->setFont(&FreeSans9pt7b);
  gfx->setTextColor(COL_TEXT);

  gfx->setCursor(10, 225);
  gfx->print("Task: ");
  gfx->print(task);

  if (recording) {
    gfx->setTextColor(COL_REC);
    gfx->setCursor(10, 250);
    gfx->print("● REC");
  } else {
    gfx->setTextColor(COL_TEXT);
    gfx->setCursor(10, 250);
    gfx->print("● STOP");
  }

  gfx->setTextColor(COL_TEXT);
  gfx->setCursor(TFT_WIDTH - 100, 225);
  char timeStr[20];
  int mins = elapsedSeconds / 60;
  int secs = elapsedSeconds % 60;
  sprintf(timeStr, "%02d:%02d", mins, secs);
  gfx->print(timeStr);
}

void DisplayManager::drawEnvelopeBar(float envelope) {
  const int barY = 272;
  const int barHeight = 8;
  const int barWidth = TFT_WIDTH - 20;
  const int barX = 10;

  gfx->fillRect(barX, barY, barWidth, barHeight, COL_ENV_BG);

  float val = envelope;
  if (val < 0) val = 0;
  if (val > 1) val = 1;
  int fillWidth = (int)(val * barWidth);
  if (fillWidth > 0) {
    gfx->fillRect(barX, barY, fillWidth, barHeight, COL_ENV_BAR);
  }
}
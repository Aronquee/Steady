# Steady – Tremor Assessment Tool

**Steady** is a portable, low‑cost system for quantitative tremor assessment.  
It combines an **ESP32‑S3** wearable sensor with a **self‑contained web dashboard** that captures, visualises and analyses accelerometric data during standardised clinical manoeuvres (rest, postural, kinetic, intentional).  

All signal processing – from **Welch PSD** to **spectrograms** and **interpretive metrics** – runs inside the browser, requiring **no backend server** and **no installation**. Data is stored locally (`IndexedDB` + `localStorage`) and can be exported for research purposes (Excel, CSV, PNG).

<img width="800" height="450" alt="STEADYSistemadeAnlisedeTremorv5 0PSDWelchMozillaFirefox2026-08-2109-11-02-Trim-ezgif com-video-to-gif-converter" src="https://github.com/user-attachments/assets/4105f55d-105b-41d3-98a5-cd1ed321fc1c" />


---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                ESP32‑S3 (Wearable Sensor)                       │
│  • QMI8658 accelerometer @ 128 Hz                               │
│  • Hardware band‑pass filter 1.5–15 Hz (Butterworth order 4)    │
│  • TFT display: scrolling waveforms + amplitude bar             │
│  • WebSocket server (AP + STA modes)                            │
│  • Binary transmission via Wi‑Fi **and** USB‑Serial             │
│  • Packet format: 28 bytes (timestamp + 3 raw + 3 filtered)     │
└────────────────────────────┬────────────────────────────────────┘
                             │ Wi‑Fi / WebSocket  or  USB‑Serial
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                Web Browser (Frontend + Analysis)                │
│  • WebSocket or Web Serial connection                           │
│  • Live charts (raw & filtered)                                 │
│  • Recording control with task/UPDRS metadata                   │
│  • Raw data stored in IndexedDB (for later re‑analysis)         │
│  • Welch PSD (512‑sample segments, 50% overlap, NFFT 1024)      │
│  • Time‑frequency spectrogram                                   │
│  • Quantitative metrics: RMS, relative power, centroid,         │
│    harmonic ratio, variability, threshold‑crossing activity     │
│  • Interpretive report with severity badges                     │
│  • Session database + comparison overlay                        │
│  • Exports: PNG (report), Excel (summary + PSD),                │
│    CSV (raw data)                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Real‑time streaming** – live charts of raw and filtered tri‑axial acceleration.
- **Dual connectivity** – connect via Wi‑Fi (WebSocket) **or** USB‑Serial (Web Serial API).
- **Offline analysis** – after recording, the dashboard computes:
  - **Power Spectral Density** (Welch method)
  - **Dominant frequency** and **relative power** in the 2–9 Hz band
  - **Spectral centroid** and **harmonic ratio**
  - **Amplitude variability** and **threshold‑crossing activity** (adaptive MAD threshold)
  - **Time‑frequency spectrogram** with dominant‑frequency overlay
- **Interpretive report** – quantitative summary with textual interpretation (mild/moderate/severe grading).
- **Local database** – all sessions stored in `localStorage` (metadata) and `IndexedDB` (raw data).
- **Comparison mode** – overlay PSDs of multiple sessions and compare metrics side‑by‑side.
- **Exports**:
  - **PNG** – full report image.
  - **Excel (.xlsx)** – summary sheet + PSD sheet for all selected sessions.
  - **CSV** – raw tri‑axial data for external validation.

---

## Hardware Requirements

- **Board:** Waveshare ESP32‑S3‑Touch‑LCD‑1.69 (ST7789V2 display, CST816T touch, AXP2101 PMU)
- **IMU:** On‑board QMI8658 (I²C address `0x6B`)
- **Power:** USB‑C or Li‑ion battery (managed by AXP2101)
- **Pinout:** defined in `Config.h` – verify against your board revision.

---

## Repository Contents

```text
Steady/
├── Firmware/                          # ESP32‑S3 firmware
│   ├── Config.h                       # Pin mapping, filter coefficients, Wi‑Fi credentials
│   ├── DSPPipeline.cpp                # Biquad cascade (Butterworth band‑pass 1.5‑15 Hz) + envelope
│   ├── DSPPipeline.h                  # DSP pipeline header
│   ├── DisplayManager.cpp             # TFT waveform rendering
│   ├── DisplayManager.h               # Display manager header
│   ├── NetworkManager.cpp             # WebSocket server, binary transmission, command handling
│   ├── NetworkManager.h               # Network manager header
│   ├── QMI8658Sensor.cpp              # QMI8658 IMU driver implementation
│   ├── QMI8658Sensor.h                # QMI8658 IMU driver header
│   ├── TremorSensor.h                 # Sensor abstraction
│   ├── steady_firmware.ino            # Main Arduino sketch (dual‑core FreeRTOS)
│   └── Fonts/                         # Custom fonts for the TFT display
├── index.html                         # Dashboard UI – structure and styles
├── script.js                          # Complete client‑side logic – connection, DSP, DB, exports
├── README.md                          # This document (English)
├── README-PTBR.md                     # Portuguese version
└── LICENSE                            # MIT License
```
---

## Firmware Setup

1. **Configure `Config.h`**
   - Set `WIFI_STA_SSID` and `WIFI_STA_PASSWORD` for your network.
   - If STA fails, the device falls back to AP mode (SSID `Steady-Device`, password `steadyadmin`).
   - **Do not change** the pre‑computed SOS coefficients (validated for 1.5–15 Hz, order 4, 128 Hz).

2. **Install required Arduino libraries**
   - `Arduino_GFX`
   - `SensorQMI8658`
   - `WiFi` / `ESPmDNS` / `ESPAsyncWebServer`

3. **Compile and upload** – select the **ESP32S3 Dev Module** in Arduino IDE / PlatformIO.

After boot, the TFT shows the IP address (or AP SSID). The device starts streaming immediately.

---

## Using the Clinical Dashboard

### 1. Open the Dashboard
Simply open `index.html` in **Chrome**, **Edge**, or **Firefox** – no web server needed.

### 2. Connect to the Sensor
- **Wi‑Fi (WebSocket):** Enter the ESP32’s IP address (e.g., `192.168.0.140`) and click **Connect WS**.
- **USB (Serial):** Click **Connect USB** and select the ESP32’s serial port from the browser prompt.

The status dot turns green when connected. The **Start Recording** button becomes active.

### 3. Set Patient, UPDRS, and Task
Fill in the patient ID, UPDRS score (optional), task type (Rest / Postural / Kinetic / Intentional), and affected side. These metadata are saved with every session.

### 4. Record a Session
- Click **Start Recording** – data begins accumulating in the browser buffer.
- Perform the clinical manoeuvre (e.g., arms resting, extended, finger‑to‑nose).
- Click **Stop Recording** – the raw data is saved to `IndexedDB` and **offline processing** starts automatically.
- The **Analysis** tab opens, displaying the PSD plot, spectrogram, metric cards, and the interpretive text.

### 5. Explore Saved Sessions
- The **Database & Comparison** tab lists all sessions.
- Select multiple sessions to:
  - **Overlay PSD curves** on the comparison chart.
  - **Compare metrics** in a side‑by‑side matrix.
  - **Export** processed data (Excel) or raw data (CSV) for the selected sessions.

### 6. Export
- **PNG:** Click **Export PNG** to save the current report as an image.
- **Excel:** Exports a summary sheet with all metrics and a PSD sheet (one column per frequency, one row per session).
- **CSV:** Exports raw tri‑axial samples for the selected sessions (timestamp, ax, ay, az, fx, fy, fz).

---

## Code Structure – `script.js` (Key Functions)

The entire client‑side logic is contained in `script.js. It is organised into clear functional groups.

### Onboarding & Initialisation
| Function | Description |
|----------|-------------|
| `DOMContentLoaded` | Shows/hides onboarding modal based on `localStorage` flag. |
| `window.onload` | Bootstraps charts, checks Web Serial support, sizes the spectrogram canvas. |
| `initCharts()` | Instantiates the 4 Chart.js plots (raw, filtered, PSD, comparison). |

### UI Helpers
| Function | Description |
|----------|-------------|
| `setRing(id, pct, color)` | Updates a circular gauge via CSS custom properties. |
| `updateFilteredScale()` | Toggles auto/fixed Y‑axis scale for the filtered chart. |
| `switchTab(tab)` | Switches between Live / Report / Compare tabs. |

### Data Ingestion (Common to WS and USB)
| Function | Description |
|----------|-------------|
| `processDataPacket(ts, ax, ay, az, fx, fy, fz)` | **Central hub** – feeds circular buffers, updates live metrics, triggers chart redraws (throttled), and appends to `recordBuffer` if recording. |

### Connectivity
| Function | Description |
|----------|-------------|
| `connectWS()` | Opens binary WebSocket; decodes 28‑byte packets and calls `processDataPacket`. |
| `connectUSB()` / `disconnectUSB()` | Manages Web Serial connection; `readLoopUSB` reassembles fragmented packets. |
| `readLoopUSB(reader)` | Asynchronous loop reading bytes, reconstructing frames, and invoking `processDataPacket`. |

### Recording & Storage
| Function | Description |
|----------|-------------|
| `startRecording()` / `stopRecording()` | Control recording buffer; on stop, saves raw data to IndexedDB and triggers offline analysis (`processSessionData`). |
| `saveRawData(sessionId, buffer)` / `getRawData()` | IndexedDB operations for raw data persistence. |
| `countRawSessions()` / `updateRawCountBadge()` | Count and display the number of sessions with raw data. |

### Core DSP (Pure computation, no DOM)
| Function | Description |
|----------|-------------|
| `meanOf(arr)` | Arithmetic mean. |
| `detrendMean(arr)` | Removes the mean (zero‑order detrend). |
| `integrateBandPower(freqs, psd, low, high)` | Trapezoidal integration with linear edge interpolation. |
| `weightedCentroid(freqs, psd, low, high)` | Spectral centroid (centre of mass) within a band. |
| `fftRadix2(real, imag)` | In‑place radix‑2 FFT (requires N power‑of‑two). |
| `computeWelchPSD3D(filtX, filtY, filtZ, fs)` | **Main PSD function** – Welch’s method with Hann window, 512‑sample segments, 50% overlap, NFFT 1024. Returns frequencies, raw/normalised PSD, total power, band‑power (2–9 Hz), dominant frequency, centroid, harmonic ratio. |
| `renderSpectrogram(filtX, filtY, filtZ, fs)` | Computes sliding‑window FFTs and draws the spectrogram on canvas (mixes computation and rendering). |
| `processSessionData(sessionId)` | **Orchestrator** – reads raw data, computes all metrics, updates UI cards, draws PSD and spectrogram, builds the session record, and persists to `localStorage`. |

### Session Management & Comparison
| Function | Description |
|----------|-------------|
| `renderSessionTable()` | Renders the list of saved sessions with selection checkboxes. |
| `clearDatabase()` | Deletes all metadata and raw data (with confirmation). |
| `selectAllSessions()` | Toggles all checkboxes. |
| `renderComparison()` | Overlays PSDs for selected sessions and builds the comparison metrics table. |

### Exports
| Function | Description |
|----------|-------------|
| `exportExcel()` | Generates an `.xlsx` with summary and PSD sheets (uses SheetJS). |
| `exportCSV()` | Exports raw data for selected sessions (CSV format). |
| `deleteSelectedRaw()` | Removes raw data from IndexedDB (keeps metadata). |
| `exportReportImage()` | Captures the report container as a PNG (uses `html2canvas`). |

> **Note:** The DSP functions (`meanOf`, `detrendMean`, `integrateBandPower`, `weightedCentroid`, `fftRadix2`, `computeWelchPSD3D`) have **zero DOM dependencies**.

---

## Clinical Metrics and Interpretation

| Metric | Description |
|--------|-------------|
| **Dominant Frequency (2–9 Hz)** | Peak of the power spectrum within the operational band. |
| **Relative Power (2–9 Hz)** | Percentage of total power (1.5–15 Hz) in the 2–9 Hz band. |
| **Band RMS (2–9 Hz)** | Square root of integrated band power – amplitude measure. |
| **Filtered Signal RMS (1.5–15 Hz)** | Total RMS of the tri‑axial filtered signal. |
| **Spectral Centroid (2–9 Hz)** | “Centre of mass” of the spectral distribution. |
| **Harmonic Ratio** | Ratio of fundamental power to the sum of 2nd and 3rd harmonic powers. |
| **Amplitude Variability (%)** | Coefficient of variation of the envelope (amplitude regularity). |
| **Threshold‑Crossing Activity (%)** | Percentage of time the envelope exceeds 2×MAD (persistence measure). |

---

## Customising the Filter

The band‑pass filter coefficients are defined in `Config.h` as a cascade of SOS.  
They were generated with:
```python
scipy.signal.butter(4, [1.5, 15], btype='band', fs=128, output='sos')
```

To change passband or sampling rate:
1. Recompute coefficients with Python/SciPy.
2. Replace `BANDPASS_SOS` in `Config.h`.
3. Update `SAMPLE_RATE_HZ` and recompile.
4. **In the frontend**, adjust `ANALYSIS_CONFIG.expectedFsHz` and the analysis bands (`signalBand`, `tremorBand`) accordingly.

---

## Screenshots

| Live Dashboard | PSD & Spectrogram | Comparison View |
|:---:|:---:|:---:|
| <img width="1920" height="931" alt="image" src="https://github.com/user-attachments/assets/e7d77a22-3b84-4015-8580-9d85eba98c1e" /> | <img width="1897" height="1600" alt="image" src="https://github.com/user-attachments/assets/7f6dbf41-e339-4427-aa75-011aabbd2e4d" />| <img width="1903" height="1356" alt="image" src="https://github.com/user-attachments/assets/7f061c8f-ab5e-44bc-abcb-dca3705ece02" />



---


## Troubleshooting

| Symptom | Probable Cause | Solution |
|---------|----------------|----------|
| TFT stays blank | Incorrect pin mapping | Verify `PIN_TFT_*` in `Config.h`. |
| IMU not detected | Wrong I²C address or wiring | Confirm `QMI8658_I2C_ADDR` (0x6B). Check SDA/SCL pins. |
| WebSocket fails | Firewall or IP mismatch | Ensure same network; try AP mode. |
| No waveform in dashboard | Data not streaming | Check ESP serial debug; confirm binary WebSocket or Serial is working. |
| Spectrogram not showing | Too short recording | Record at least 5 seconds for adequate resolution. |
| Excel/CSV export fails | Raw data missing | Older sessions may not have raw data; use processed export. |
| USB connection fails | Browser lacks Web Serial API | Use Chrome/Edge; install serial driver. |

---

## Credits

Hardware design based on the Waveshare ESP32‑S3‑Touch‑LCD‑1.69 board.  
Signal‑processing concepts drawn from established tremor‑analysis literature.

---

**Contact:** [Matheus Aronque / aronque@hotmail.com]

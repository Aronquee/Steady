# Steady – Clinical Tremor Assessment Tool

**Steady** is a portable system for quantitative tremor assessment. It combines an ESP32‑S3‑based wearable sensor with a self‑contained web interface, enabling clinicians to capture, visualize, and analyze tremor during standardized maneuvers (rest, postural, kinetic, intentional).

The device transmits raw and filtered accelerometer data (band‑pass) in real time via Wi‑Fi (WebSocket) or **USB (Serial)**. The included HTML dashboard provides live charts, recording controls, and a comprehensive offline report with spectral metrics and quantitative interpretation, plus a **local database** with **session comparison** and **advanced data export** for future research – all without installing any software beyond a modern browser.

---

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                 ESP32‑S3 (Wearable Sensor)                   │
│  • QMI8658 Accelerometer @ 128 Hz                           │
│  • Fixed band‑pass filter 1.5–15 Hz (Butterworth order 4)   │
│  • TFT display: scrolling waveforms + amplitude bar         │
│  • WebSocket server (AP + STA modes)                       │
│  • Binary transmission via Wi‑Fi and **USB‑Serial**        │
│  • Packet: 28 bytes (timestamp + 3 raw + 3 filtered)       │
└───────────────────────────┬─────────────────────────────────┘
                            │ Wi‑Fi / WebSocket or USB‑Serial
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Web Browser (Frontend + Analysis)             │
│  • WebSocket or Web Serial (USB) connection                  │
│  • Live charts (raw and filtered)                           │
│  • Recording control, task selection, and UPDRS input       │
│  • Raw data storage in **IndexedDB**                        │
│  • Welch PSD (512 segments, 50% overlap, NFFT 1024)         │
│  • Time‑frequency spectrogram                               │
│  • Quantitative metrics (RMS, relative power,               │
│    spectral centroid, harmonic ratio, variability,          │
│    threshold‑crossing activity)                             │
│  • Interpretive report with analysis badges                 │
│  • Session database and **comparison** across sessions      │
│  • Exports: PNG (report), Excel (summary + PSD),            │
│    CSV (raw data)                                           │
└─────────────────────────────────────────────────────────────────┘
```

The ESP32 acts as a **transparent measurement front‑end** – it does not perform classification or episode detection. All diagnostic interpretation occurs in the browser, using well‑established signal‑processing techniques.

---

## Hardware Requirements

- **Board:** Waveshare ESP32‑S3‑Touch‑LCD‑1.69 (ST7789V2 display, CST816T touch, AXP2101 PMU)
- **IMU:** Onboard QMI8658 (I²C address `0x6B`)
- **Power:** USB‑C or Li‑ion battery (managed by AXP2101)
- **Pinout:** defined in `Config.h` – verify against your board revision before wiring.

---

## Repository Contents

| File / Folder | Description |
|---------------|-------------|
| `steady_firmware.ino` | Main Arduino sketch (dual‑core FreeRTOS) |
| `Config.h` | Pin mapping, filter coefficients, Wi‑Fi credentials |
| `TremorSensor.h` / `QMI8658Sensor.cpp` | IMU abstraction and driver |
| `DSPPipeline.h/.cpp` | Biquad cascade (Butterworth band‑pass 1.5–15 Hz) + envelope |
| `DisplayManager.h/.cpp` | TFT waveform rendering |
| `NetworkManager.h/.cpp` | WebSocket server, binary transmission, command handling |
| **`index.html`** | **Clinical dashboard – structure and design** (UI) |
| **`script.js`** | **Complete dashboard logic** – WebSocket/USB connection, signal processing, metrics, interpretation, local database, and exports |
| `README.md` | This document |

---

## Firmware Setup

### 1. Configure `Config.h`

- **Wi‑Fi:** Set `WIFI_STA_SSID` and `WIFI_STA_PASSWORD` for your network. If STA mode fails, the device falls back to AP mode with SSID `Steady-Device` (password `steadyadmin`).
- **Filter coefficients:** The pre‑computed SOS coefficients were validated with `scipy.signal.butter` for a **1.5–15 Hz** band, order 4, at 128 Hz – **do not change** them unless you have recalibrated the filter.
- **Sampling rate:** `SAMPLE_RATE_HZ = 128` (fixed; changing it requires filter recalculation and updating the frontend analysis parameters).

### 2. Install Required Arduino Libraries

- `Arduino_GFX` (for the display)
- `SensorQMI8658` (IMU driver)
- `WiFi` / `ESPmDNS` / `ESPAsyncWebServer` (ESP32 core libraries)

### 3. Compile and Upload

Open `steady_firmware.ino` in the Arduino IDE (or PlatformIO). Select the **ESP32S3 Dev Module** board with the appropriate USB/serial settings. Flash the firmware.

After startup, the device prints its IP address (or AP SSID) to the serial monitor (`115200 baud`). The TFT will show a boot message and then begin displaying real‑time filtered waveforms once data starts flowing.

---

## Using the Clinical Dashboard

### 1. Connect to the Device

- **Wi‑Fi STA mode:** Your computer must be on the same network as the ESP32. Open a browser and go to `http://steady.local` (mDNS) or the IP address shown in the serial monitor.
- **Wi‑Fi AP mode:** Connect your computer to the `Steady-Device` network (password `steadyadmin`). Then open `http://192.168.4.1` (or the AP IP printed on the serial).

### 2. Open `index.html`

Simply open `index.html` in any modern browser (Chrome, Edge, Firefox). No web server is required – the file works locally.

> **Separation of concerns:**  
> - `index.html` contains the full HTML structure and CSS styles (design).  
> - `script.js` contains all the logic – connection (WebSocket and USB), signal processing, chart updates, metric calculations, quantitative interpretation, local database, and exports.

### 3. Connect to the Sensor

- **Wi‑Fi:** Enter the ESP32’s IP address in the field (default `192.168.0.140`) and click **Connect WS**. The status dot turns green, and the **Start Recording** button becomes active.
- **USB:** Click **Connect USB** – the browser will prompt you to select the ESP32’s serial port. Once connected, the USB status turns green, and recording becomes available (independent of Wi‑Fi). All data received over the serial port is processed identically to WebSocket data.

### 4. Set Patient, UPDRS, and Task

- Fill in the patient ID and the UPDRS score (Part IV, optional).
- Choose the task (**Rest**, **Postural**, **Kinetic**, **Intentional**) and the affected side.
- These fields are saved with every recording session.

### 5. Recording a Session

- Click **Start Recording** – the device begins streaming frames, and the TFT shows a “REC” indicator.
- Perform the chosen clinical maneuver (e.g., arms resting on lap, arms extended, finger‑to‑nose).
- Click **Stop Recording** – the browser stores the **raw data** in IndexedDB (for future research) and processes the entire buffer offline.
- The dashboard automatically switches to the **Analysis** tab, displaying:
  - Dominant frequency (within the 2–9 Hz operational band)
  - Relative power 2–9 Hz and band RMS
  - Spectral centroid and harmonic ratio
  - Amplitude variability and threshold‑crossing activity
  - Power Spectral Density (Welch) plot
  - Time‑frequency spectrogram
  - Quantitative signal interpretation (without automatic diagnostic classification)

### 6. Exporting Data

- **PNG:** Click **Export PNG** to save the full report as an image.
- **Session database:** All completed sessions are stored in the browser’s `localStorage` (metadata) and IndexedDB (raw data). The **Database & Comparison** tab allows you to:
  - Select multiple sessions to overlay their PSD curves
  - Display a side‑by‑side comparison matrix of metrics
  - **Export processed data (.xlsx):** includes a summary sheet with all metrics and a second sheet with the PSDs (for statistical analysis)
  - **Export raw data (.csv):** all axes (ax, ay, az, fx, fy, fz) for the selected sessions, for external validation
  - **Delete raw data** from selected sessions (saves IndexedDB space while keeping metadata for comparison)

---

## Clinical Metrics and Interpretation

| Metric | Description |
|--------|-------------|
| **Dominant Frequency (2–9 Hz)** | Peak of the power spectrum within the operational band, obtained via Welch’s method. |
| **Relative Power (2–9 Hz)** | Percentage of total power (1.5–15 Hz) concentrated in the 2–9 Hz band. |
| **Band RMS (2–9 Hz)** | Square root of the integrated power in the 2–9 Hz band – a tremor amplitude measure. |
| **Filtered Signal RMS (1.5–15 Hz)** | Square root of the total power of the received filtered signal (triaxial). |
| **Spectral Centroid (2–9 Hz)** | “Center of mass” of the spectral distribution within the 2–9 Hz band. |
| **Harmonic Ratio** | Ratio of the fundamental frequency power to the sum of the 2nd and 3rd harmonic powers. |
| **Amplitude Variability (%)** | Coefficient of variation of the filtered signal envelope – describes amplitude regularity. |
| **Threshold‑Crossing Activity (%)** | Fraction of time the envelope exceeds an adaptive threshold (2× MAD) – a measure of tremor persistence. |

The dashboard generates a **textual interpretation** combining these metrics, with severity grading (mild / moderate / severe) based purely on quantitative rules, **without replacing clinical judgment**.

---

## Customizing the Filter

The band‑pass filter is defined in `Config.h` as a cascade of second‑order sections (SOS). Coefficients were generated using `scipy.signal.butter(4, [1.5, 15], btype='band', fs=128, output='sos')`.

To change the passband or sampling rate:
1. Recompute the coefficients with Python / SciPy.
2. Replace the `BANDPASS_SOS` array in `Config.h`.
3. Update `SAMPLE_RATE_HZ` and recompile.
4. **In the frontend**, also adjust `ANALYSIS_CONFIG.expectedFsHz` and the analysis bands (`signalBand`, `tremorBand`) to maintain consistency.

> **Important:** The browser‑side analysis uses the raw acceleration data (ax, ay, az) and recomputes the spectrum independently. The ESP’s filtered outputs (fx, fy, fz) are used only for live display and RMS estimation during recording – the final report is based on raw data to ensure consistency.

---

## Code Logic – `script.js`

The `script.js` file implements all client‑side processing. Its main flow is:

1. **Connection**  
   - Establishes a binary WebSocket with the ESP32 **or** a Web Serial (USB) connection.  
   - Receives 28‑byte frames (timestamp, ax, ay, az, fx, fy, fz).  
   - Accumulates points in circular buffers for live charts.

2. **Recording**  
   - When the user starts recording, all incoming frames are stored in `recordBuffer`.  
   - When stopped, the buffer is **saved to IndexedDB** (raw data) and processed offline.

3. **Signal Processing (offline)**  
   - **Combined magnitude** of the filtered axes.  
   - **Amplitude metrics**: total RMS, MAD, ENMO, variability (CV of envelope), threshold‑crossing activity (based on adaptive MAD threshold).  
   - **Displacement estimation** via double integration with drift removal (for qualitative analysis).  
   - **PSD (Welch)**: segmentation with Hanning window (512 samples, 50% overlap), radix‑2 FFT (NFFT 1024), segment averaging, and normalization.  
   - **Dominant frequency** and relative power in the 2–9 Hz band.  
   - **Spectral centroid** and **harmonic ratio** (fundamental vs. 2nd and 3rd harmonics).  
   - **Spectrogram**: sliding windows, column‑wise FFT, “inferno” colormap, and dominant‑frequency curve overlay.  
   - **Quantitative interpretation** based on heuristic rules (frequency, relative power, variability, etc.), with severity badges.

4. **UI Updates**  
   - Fills metric cards, PSD chart, and spectrogram.  
   - Displays the interpretive text with quantitative analysis badges.

5. **Local Database**  
   - Each session is saved in `localStorage` (metadata) and **IndexedDB** (raw data).  
   - The **Compare** tab allows session selection, PSD overlay, metric comparison matrix, and batch data export.

6. **Export**  
   - Uses `html2canvas` to capture the report and generate a PNG.  
   - Uses `SheetJS` (XLSX) to export summary and PSDs.  
   - Generates CSV with all raw axes for the selected sessions.

All processing functions (FFT, PSD, spectrogram) are implemented in pure JavaScript, with minimal external dependencies (Chart.js, html2canvas, SheetJS).

---

## Troubleshooting

| Symptom | Probable Cause | Solution |
|---------|----------------|----------|
| TFT stays blank | Incorrect pin mapping | Verify `PIN_TFT_*` in `Config.h` against your board. |
| IMU not detected | Wrong I²C address or wiring | Confirm `QMI8658_I2C_ADDR` (0x6B). Check SDA/SCL pins. |
| WebSocket connection fails | Firewall or IP mismatch | Ensure computer and ESP are on the same subnet. Use AP mode if needed. |
| No waveform in dashboard | Data not being transmitted | Check that the ESP is sending frames (serial debug). Ensure browser supports binary WebSocket or Web Serial. |
| Spectrogram not showing | Insufficient recording duration | Record at least 5 seconds of movement for adequate resolution. |
| Excel/CSV export fails | Raw data missing in IndexedDB | Older sessions may lack raw data. Use the processed export (Excel) to obtain PSDs. |
| USB connection fails | Browser lacks Web Serial API support | Use Chrome or Edge. Verify the serial driver is installed. |

---

## Credits

Developed as part of a biomedical engineering research initiative. The hardware design is based on the Waveshare ESP32‑S3‑Touch‑LCD‑1.69 board. Signal‑processing concepts are derived from established tremor‑analysis literature.


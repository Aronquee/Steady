// ======================================================================
//  ONBOARDING
// ======================================================================
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('onboardingModal');
    const closeBtn = document.getElementById('closeOnboardingBtn');
    if (localStorage.getItem('steady_onboarding_v1') === 'true') {
        modal.classList.add('hidden');
    }
    closeBtn.addEventListener('click', function() {
        modal.classList.add('hidden');
        localStorage.setItem('steady_onboarding_v1', 'true');
    });
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.classList.add('hidden');
            localStorage.setItem('steady_onboarding_v1', 'true');
        }
    });
});

// ======================================================================
//  GLOBAL STATE
// ======================================================================
let ws = null;
let isRecording = false;
let recordBuffer = [];
let recStartTime = 0;
let recTimerInterval = null;
let chartUpdatePending = false;
const MAX_LIVE_POINTS = 300;
const pendingRaw = { ts: [], ax: [], ay: [], az: [] };
const pendingFilt = { ts: [], fx: [], fy: [], fz: [] };

let rawChart, filteredChart, psdChart, compareChart;
let spectroCtx = null;
let spectroCanvas = null;
let savedSessions = [];

// Estado USB
let usbPort = null;
let usbReader = null;
let usbReadableStream = null;
let usbConnected = false;

try {
    savedSessions = JSON.parse(localStorage.getItem('steady_sessions') || '[]');
} catch (e) {
    console.warn('Erro ao ler localStorage, usando array vazio.');
    savedSessions = [];
}

let _lastFiltX = null,
    _lastFiltY = null,
    _lastFiltZ = null,
    _lastFs = null;

// ======================================================================
//  INIT
// ======================================================================
window.onload = () => {
    initCharts();
    renderSessionTable();
    document.getElementById('exportBtn').disabled = true;
    spectroCanvas = document.getElementById('spectrogramCanvas');
    spectroCtx = spectroCanvas.getContext('2d');
    setTimeout(resizeSpectrogram, 100);
    // Verifica suporte a USB
    if (!('serial' in navigator)) {
        document.getElementById('connectUsbBtn').disabled = true;
        document.getElementById('connectUsbBtn').title = 'Web Serial API não suportada neste navegador';
        document.getElementById('usbStatusText').textContent = 'USB não suportado';
    }
};
window.addEventListener('resize', () => {
    resizeSpectrogram();
});

function resizeSpectrogram() {
    const container = spectroCanvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let w = rect.width || 400;
    let h = rect.height || 200;
    const dpr = window.devicePixelRatio || 1;
    spectroCanvas.width = w * dpr;
    spectroCanvas.height = h * dpr;
    spectroCanvas.style.width = w + 'px';
    spectroCanvas.style.height = h + 'px';
}

// ======================================================================
//  CHART INIT
// ======================================================================
function initCharts() {
    let annotationPluginAvailable = false;
    if (typeof ChartAnnotation !== 'undefined') {
        Chart.register(ChartAnnotation);
        annotationPluginAvailable = true;
        console.log('Plugin de anotação registrado.');
    } else {
        console.warn('Plugin de anotação não encontrado. As anotações do PSD não funcionarão.');
    }

    const commonOpts = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: { labels: { color: '#6B7A8B' } }
        },
        scales: {
            x: { grid: { color: '#E9EDF2' }, ticks: { color: '#6B7A8B' } },
            y: { grid: { color: '#E9EDF2' }, ticks: { color: '#6B7A8B' } }
        }
    };

    rawChart = new Chart(document.getElementById('rawChart'), {
        type: 'line',
        options: commonOpts,
        data: {
            labels: [],
            datasets: [
                { label: 'X', data: [], borderColor: '#C43A44', borderWidth: 1.5, pointRadius: 0 },
                { label: 'Y', data: [], borderColor: '#1E7BAD', borderWidth: 1.5, pointRadius: 0 },
                { label: 'Z', data: [], borderColor: '#86929E', borderWidth: 1.5, pointRadius: 0 }
            ]
        }
    });

    const filtOpts = JSON.parse(JSON.stringify(commonOpts));
    filtOpts.scales.y.min = -0.25;
    filtOpts.scales.y.max = 0.25;
    filteredChart = new Chart(document.getElementById('filteredChart'), {
        type: 'line',
        options: filtOpts,
        data: {
            labels: [],
            datasets: [
                { label: 'Filt X', data: [], borderColor: '#C43A44', borderWidth: 1.5, pointRadius: 0 },
                { label: 'Filt Y', data: [], borderColor: '#1E7BAD', borderWidth: 1.5, pointRadius: 0 },
                { label: 'Filt Z', data: [], borderColor: '#86929E', borderWidth: 1.5, pointRadius: 0 }
            ]
        }
    });

    const psdOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#1E7BAD' } }
        },
        scales: {
            x: { grid: { color: '#E9EDF2' }, ticks: { color: '#6B7A8B' }, title: { display: true,
                    text: 'Frequência (Hz)', color: '#6B7A8B' } },
            y: { grid: { color: '#E9EDF2' }, ticks: { color: '#6B7A8B' }, title: { display: true,
                    text: 'Magnitude Normalizada', color: '#6B7A8B' }, min: 0, max: 1.05 }
        }
    };

    if (annotationPluginAvailable) {
        psdOptions.plugins.annotation = {
            annotations: {
                box3_8: {
                    type: 'box',
                    xMin: 3,
                    xMax: 8,
                    yMin: 0,
                    yMax: 1.1,
                    backgroundColor: 'rgba(30,123,173,0.08)',
                    borderColor: 'rgba(30,123,173,0.3)',
                    borderWidth: 1,
                    label: {
                        content: '3–8 Hz',
                        enabled: true,
                        position: 'top',
                        color: '#1E7BAD',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                domLine: {
                    type: 'line',
                    xMin: 0,
                    xMax: 0,
                    yMin: 0,
                    yMax: 1.1,
                    borderColor: '#C43A44',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    label: {
                        content: 'Freq. Dominante',
                        enabled: true,
                        position: 'start',
                        color: '#C43A44',
                        font: { size: 10, weight: 'bold' }
                    }
                }
            }
        };
    }

    psdChart = new Chart(document.getElementById('psdChart'), {
        type: 'line',
        options: psdOptions,
        data: {
            labels: [],
            datasets: [{
                label: 'PSD (Welch)',
                data: [],
                borderColor: '#1E7BAD',
                backgroundColor: 'rgba(30,123,173,0.10)',
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2
            }]
        }
    });

    compareChart = new Chart(document.getElementById('compareChart'), {
        type: 'line',
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#6B7A8B' } } },
            scales: {
                x: { grid: { color: '#E9EDF2' }, ticks: { color: '#6B7A8B' } },
                y: { grid: { color: '#E9EDF2' }, ticks: { color: '#6B7A8B' }, min: 0, max: 1.05 }
            }
        },
        data: { labels: [], datasets: [] }
    });
}

// ======================================================================
//  RING GAUGE
// ======================================================================
function setRing(id, pct, color) {
    const el = document.getElementById(id);
    if (!el) return;
    const clamped = Math.max(0, Math.min(100, pct));
    el.style.setProperty('--pct', clamped.toFixed(1));
    if (color) el.style.setProperty('--ring-color', color);
}

function updateFilteredScale() {
    const val = document.getElementById('yScaleSelect').value;
    if (val === 'auto') {
        delete filteredChart.options.scales.y.min;
        delete filteredChart.options.scales.y.max;
    } else {
        const num = parseFloat(val);
        filteredChart.options.scales.y.min = -num;
        filteredChart.options.scales.y.max = num;
    }
    filteredChart.update();
}

// ======================================================================
//  TAB SWITCH
// ======================================================================
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

    if (tab === 'live') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('tab-live').classList.remove('hidden');
    } else if (tab === 'report') {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('tab-report').classList.remove('hidden');
        if (_lastFiltX && _lastFiltY && _lastFiltZ && _lastFs) {
            setTimeout(() => {
                resizeSpectrogram();
                renderSpectrogram(_lastFiltX, _lastFiltY, _lastFiltZ, _lastFs);
            }, 150);
        }
    } else if (tab === 'compare') {
        document.querySelectorAll('.tab-btn')[2].classList.add('active');
        document.getElementById('tab-compare').classList.remove('hidden');
    }
}

// ======================================================================
//  PROCESSAMENTO COMUM DE PACOTES
// ======================================================================
function processDataPacket(ts, ax, ay, az, fx, fy, fz) {
    console.log('[processDataPacket] Entrou com:', ts, ax, ay, az, fx, fy, fz);
    pendingRaw.ts.push(ts);
    pendingRaw.ax.push(ax);
    pendingRaw.ay.push(ay);
    pendingRaw.az.push(az);
    pendingFilt.ts.push(ts);
    pendingFilt.fx.push(fx);
    pendingFilt.fy.push(fy);
    pendingFilt.fz.push(fz);

    if (pendingRaw.ts.length > MAX_LIVE_POINTS) {
        pendingRaw.ts.shift();
        pendingRaw.ax.shift();
        pendingRaw.ay.shift();
        pendingRaw.az.shift();
        pendingFilt.ts.shift();
        pendingFilt.fx.shift();
        pendingFilt.fy.shift();
        pendingFilt.fz.shift();
    }

    const rms = Math.sqrt((fx * fx + fy * fy + fz * fz) / 3);
    document.getElementById('liveRMS').innerHTML =
        `${rms.toFixed(3)} <span style="font-size:16px;">g</span>`;
    setRing('liveRMSRing', (rms / 0.15) * 100, rms >= 0.15 ? 'var(--red-500)' : 'var(--blue-500)');

    const rawMag = Math.sqrt(ax * ax + ay * ay + az * az);
    const enmo = Math.max(0, rawMag - 1.0);
    document.getElementById('liveENMO').innerHTML =
        `${enmo.toFixed(3)} <span style="font-size:16px;">g</span>`;

    if (pendingFilt.fx.length > 20) {
        const mags = pendingFilt.fx.map((_, i) =>
            Math.sqrt(pendingFilt.fx[i] ** 2 + pendingFilt.fy[i] ** 2 + pendingFilt.fz[i] ** 2)
        );
        const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
        const mad = mags.reduce((a, b) => a + Math.abs(b - mean), 0) / mags.length;
        document.getElementById('liveMAD').innerHTML =
            `${mad.toFixed(3)} <span style="font-size:16px;">g</span>`;
    }

    if (!chartUpdatePending) {
        chartUpdatePending = true;
        setTimeout(() => {
            const offset = pendingRaw.ts.length > 0 ? pendingRaw.ts[0] : 0;
            const labels = pendingRaw.ts.map(t => ((t - offset) / 1000).toFixed(1));

            rawChart.data.labels = labels;
            rawChart.data.datasets[0].data = pendingRaw.ax.slice();
            rawChart.data.datasets[1].data = pendingRaw.ay.slice();
            rawChart.data.datasets[2].data = pendingRaw.az.slice();
            rawChart.update('none');

            filteredChart.data.labels = labels;
            filteredChart.data.datasets[0].data = pendingFilt.fx.slice();
            filteredChart.data.datasets[1].data = pendingFilt.fy.slice();
            filteredChart.data.datasets[2].data = pendingFilt.fz.slice();
            filteredChart.update('none');

            chartUpdatePending = false;
        }, 50);
    }

    if (isRecording) {
        recordBuffer.push([ts, ax, ay, az, fx, fy, fz]);
        document.getElementById('bufferCount').textContent = recordBuffer.length;
    }
}

// ======================================================================
//  WEBSOCKET
// ======================================================================
function connectWS() {
    const ip = document.getElementById('ipInput').value.trim();
    ws = new WebSocket(`ws://${ip}/ws`);
    ws.binaryType = 'arraybuffer';

    document.getElementById('statusText').textContent = 'Conectando…';

    ws.onopen = () => {
        document.getElementById('statusDot').className = 'dot connected';
        document.getElementById('statusText').textContent = 'Conectado';
        document.getElementById('startBtn').disabled = false;
        document.getElementById('connectBtn').disabled = true;
    };

    ws.onclose = () => {
        document.getElementById('statusDot').className = 'dot';
        document.getElementById('statusText').textContent = 'WS Desconectado';
        document.getElementById('startBtn').disabled = true;
        document.getElementById('connectBtn').disabled = false;
        if (isRecording) stopRecording();
    };

    ws.onmessage = (evt) => {
        if (evt.data.byteLength === 28) {
            const dv = new DataView(evt.data);
            const ts = dv.getUint32(0, true);
            const ax = dv.getFloat32(4, true),
                ay = dv.getFloat32(8, true),
                az = dv.getFloat32(12, true);
            const fx = dv.getFloat32(16, true),
                fy = dv.getFloat32(20, true),
                fz = dv.getFloat32(24, true);
            processDataPacket(ts, ax, ay, az, fx, fy, fz);
        }
    };
}

// ======================================================================
//  USB (Web Serial)
// ======================================================================
async function connectUSB() {
    if (!('serial' in navigator)) {
        alert('Web Serial API não suportada neste navegador. Use Chrome ou Edge.');
        return;
    }

    if (usbConnected) {
        // Desconectar
        await disconnectUSB();
        return;
    }

    try {
        // Solicita porta
        const port = await navigator.serial.requestPort();
        usbPort = port;

        // Abre com baud rate (ajuste conforme seu dispositivo)
        await port.open({ baudRate: 115200 });

        usbConnected = true;
        document.getElementById('usbStatusDot').className = 'status-usb connected';
        document.getElementById('usbStatusText').textContent = 'USB Conectado';
        document.getElementById('connectUsbBtn').textContent = 'Desconectar USB';
        document.getElementById('startBtn').disabled = false;

        // Inicia leitura
        const reader = port.readable.getReader();
        usbReader = reader;
        readLoopUSB(reader);

    } catch (err) {
        console.error('Erro ao conectar USB:', err);
        alert('Falha ao conectar USB: ' + err.message);
        await disconnectUSB();
    }
}

async function disconnectUSB() {
    usbConnected = false;
    if (usbReader) {
        try { await usbReader.cancel(); } catch (e) {}
        usbReader = null;
    }
    if (usbPort) {
        try { await usbPort.close(); } catch (e) {}
        usbPort = null;
    }
    document.getElementById('usbStatusDot').className = 'status-usb';
    document.getElementById('usbStatusText').textContent = 'USB Desconectado';
    document.getElementById('connectUsbBtn').textContent = 'Conectar USB';
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        document.getElementById('startBtn').disabled = true;
    }
}

async function readLoopUSB(reader) {
    let buffer = new Uint8Array(0);
    const expectedLen = 28;

    try {
        while (true) {
            const { value, done } = await reader.read();
            console.log('[USB] read() retornou:', { done, valueLength: value ? value.length : 0 });
            if (done || !usbConnected) break;

            // Concatena ao buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer, 0);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;
            console.log('[USB] Buffer atual:', buffer.length, 'bytes');
            // Processa todos os pacotes completos
            while (buffer.length >= expectedLen) {
                const packet = buffer.slice(0, expectedLen);
                buffer = buffer.slice(expectedLen);

                // Interpreta como little-endian: timestamp uint32 + 6 floats
                const dv = new DataView(packet.buffer);
                const ts = dv.getUint32(0, true);
                const ax = dv.getFloat32(4, true);
                const ay = dv.getFloat32(8, true);
                const az = dv.getFloat32(12, true);
                const fx = dv.getFloat32(16, true);
                const fy = dv.getFloat32(20, true);
                const fz = dv.getFloat32(24, true);
                console.log('[USB] Pacote extraído, chamando processDataPacket com:', { ts, ax, ay, az, fx, fy, fz });
                processDataPacket(ts, ax, ay, az, fx, fy, fz);
            }
        }
    } catch (err) {
        if (err.name !== 'CancelError') {
            console.error('Erro na leitura USB:', err);
        }
    } finally {
        // Se a leitura parar, desconecta
        if (usbConnected) {
            await disconnectUSB();
        }
    }
}

// ======================================================================
//  RECORDING
// ======================================================================
function startRecording() {
    isRecording = true;
    recordBuffer = [];
    recStartTime = performance.now();

    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('recTimer').classList.remove('hidden');
    document.getElementById('recStatus').textContent = 'GRAVANDO';
    document.getElementById('recStatus').style.color = 'var(--accent-red)';
    document.getElementById('exportBtn').disabled = true;

    // Envia comando de start via WS (se conectado)
    if (ws && ws.readyState === WebSocket.OPEN) ws.send('start');
    // Para USB, não há comando, apenas grava os dados que chegam.

    recTimerInterval = setInterval(() => {
        const elapsed = Math.floor((performance.now() - recStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        document.getElementById('recTimer').innerHTML =
            `<span class="rec-pulse"></span> ${m}:${s}`;
    }, 200);
}

function stopRecording() {
    isRecording = false;
    clearInterval(recTimerInterval);

    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('recTimer').classList.add('hidden');
    document.getElementById('recStatus').textContent = 'Em espera';
    document.getElementById('recStatus').style.color = 'var(--text-muted)';

    if (ws && ws.readyState === WebSocket.OPEN) ws.send('stop');

    if (recordBuffer.length > 30) {
        processSessionData();
        document.getElementById('exportBtn').disabled = false;
    } else {
        alert('Gravação muito curta para análise espectral.');
    }
}

// ======================================================================
//  CORE SIGNAL PROCESSING (mesmo código)
// ======================================================================
function processSessionData() {
    const patId = document.getElementById('patientId').value.trim() || 'NÃO IDENTIFICADO';
    const task = document.getElementById('taskSelect').value;
    const side = document.getElementById('sideSelect').value;

    const t0 = recordBuffer[0][0];
    const tN = recordBuffer[recordBuffer.length - 1][0];
    const durationSec = Math.max(0.1, (tN - t0) / 1000);
    const fs = recordBuffer.length / durationSec;

    const filtX = recordBuffer.map(r => r[4]);
    const filtY = recordBuffer.map(r => r[5]);
    const filtZ = recordBuffer.map(r => r[6]);

    _lastFiltX = filtX;
    _lastFiltY = filtY;
    _lastFiltZ = filtZ;
    _lastFs = fs;

    const filtMag = filtX.map((_, i) => Math.sqrt(filtX[i] ** 2 + filtY[i] ** 2 + filtZ[i] ** 2));
    const meanMag = filtMag.reduce((a, b) => a + b, 0) / filtMag.length;
    const acMag = filtMag.map(v => v - meanMag);

    const rmsVal = Math.sqrt(acMag.reduce((s, v) => s + v * v, 0) / acMag.length);
    const meanFilt = acMag.reduce((a, b) => a + b, 0) / acMag.length;
    const madVal = acMag.reduce((a, b) => a + Math.abs(b - meanFilt), 0) / acMag.length;
    const rawX = recordBuffer.map(r => r[1]);
    const rawY = recordBuffer.map(r => r[2]);
    const rawZ = recordBuffer.map(r => r[3]);
    const rawMag = rawX.map((_, i) => Math.sqrt(rawX[i] ** 2 + rawY[i] ** 2 + rawZ[i] ** 2));
    const meanRaw = rawMag.reduce((a, b) => a + b, 0) / rawMag.length;
    const enmoVal = Math.max(0, meanRaw - 1.0);

    const envelope = acMag.map(v => Math.abs(v));
    const meanEnv = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    const stdEnv = Math.sqrt(envelope.reduce((s, v) => s + (v - meanEnv) ** 2, 0) / envelope.length);
    const variab = meanEnv > 0 ? (stdEnv / meanEnv) * 100 : 0;

    const sortedMag = [...acMag].sort((a, b) => a - b);
    const medianMag = sortedMag[Math.floor(sortedMag.length / 2)];
    const madMag = acMag.reduce((s, v) => s + Math.abs(v - medianMag), 0) / acMag.length;
    const dynamicThreshold = Math.max(0.02, 2 * madMag);
    const onTime = (acMag.filter(v => Math.abs(v) > dynamicThreshold).length / acMag.length) * 100;

    const segLen = Math.min(256, Math.floor(recordBuffer.length / 4));
    const overlap = Math.floor(segLen * 0.5);
    const nSegs = Math.max(1, Math.floor((recordBuffer.length - overlap) / (segLen - overlap)));

    let allPsd = [];
    let allFreqs = [];

    for (let s = 0; s < nSegs; s++) {
        const start = s * (segLen - overlap);
        const end = Math.min(start + segLen, recordBuffer.length);
        const segX = filtX.slice(start, end);
        const segY = filtY.slice(start, end);
        const segZ = filtZ.slice(start, end);
        if (segX.length < 16) continue;

        const N = segX.length;
        const nFft = Math.pow(2, Math.ceil(Math.log2(N)));
        const realX = new Float32Array(nFft),
            imagX = new Float32Array(nFft);
        const realY = new Float32Array(nFft),
            imagY = new Float32Array(nFft);
        const realZ = new Float32Array(nFft),
            imagZ = new Float32Array(nFft);
        for (let i = 0; i < N; i++) {
            const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
            realX[i] = segX[i] * win;
            realY[i] = segY[i] * win;
            realZ[i] = segZ[i] * win;
        }
        fftRadix2(realX, imagX);
        fftRadix2(realY, imagY);
        fftRadix2(realZ, imagZ);

        const half = nFft / 2;
        const psdSeg = [];
        const freqSeg = [];
        for (let i = 1; i < half; i++) {
            const f = i * (fs / nFft);
            if (f > 20) break;
            const pwr = (realX[i] * realX[i] + imagX[i] * imagX[i] +
                    realY[i] * realY[i] + imagY[i] * imagY[i] +
                    realZ[i] * realZ[i] + imagZ[i] * imagZ[i]) / nFft;
            psdSeg.push(pwr);
            freqSeg.push(f);
        }
        if (allPsd.length === 0) {
            allPsd = psdSeg.map(() => 0);
            allFreqs = freqSeg;
        }
        for (let i = 0; i < psdSeg.length && i < allPsd.length; i++) {
            allPsd[i] += psdSeg[i];
        }
    }

    if (allPsd.length === 0) {
        alert('Não foi possível calcular o espectro. Dados insuficientes.');
        return;
    }

    const denom = nSegs > 0 ? nSegs : 1;
    allPsd = allPsd.map(p => p / denom);

    let peakFreq = 0,
        maxPwr = 0;
    const MIN_FREQ = 1.5;
    for (let i = 0; i < allFreqs.length; i++) {
        if (allFreqs[i] < MIN_FREQ) continue;
        if (allPsd[i] > maxPwr) {
            maxPwr = allPsd[i];
            peakFreq = allFreqs[i];
        }
    }
    if (peakFreq === 0 && allFreqs.length > 0) {
        let fallbackMax = 0;
        for (let i = 0; i < allFreqs.length; i++) {
            if (allPsd[i] > fallbackMax) {
                fallbackMax = allPsd[i];
                peakFreq = allFreqs[i];
            }
        }
    }

    const psdNorm = maxPwr > 0 ? allPsd.map(p => p / maxPwr) : allPsd;

    let totalPow = 0,
        bandPow = 0;
    for (let i = 0; i < allFreqs.length; i++) {
        const f = allFreqs[i];
        totalPow += allPsd[i];
        if (f >= 3 && f <= 8) bandPow += allPsd[i];
    }
    const relPower = totalPow > 0 ? (bandPow / totalPow) * 100 : 0;

    let weightedSum = 0,
        powSum = 0;
    for (let i = 0; i < allFreqs.length; i++) {
        weightedSum += allFreqs[i] * allPsd[i];
        powSum += allPsd[i];
    }
    const centroid = powSum > 0 ? weightedSum / powSum : 0;

    const df = allFreqs.length > 1 ? allFreqs[1] - allFreqs[0] : 0.1;
    const nBins = 2;
    const halfBand = nBins * df;

    function sumPowerInBand(freq, freqs, psd) {
        let sum = 0;
        const low = freq - halfBand;
        const high = freq + halfBand;
        for (let i = 0; i < freqs.length; i++) {
            if (freqs[i] >= low && freqs[i] <= high) {
                sum += psd[i];
            }
        }
        return sum;
    }

    const fundPow = sumPowerInBand(peakFreq, allFreqs, allPsd);
    const harm2Pow = sumPowerInBand(2 * peakFreq, allFreqs, allPsd);
    const harm3Pow = sumPowerInBand(3 * peakFreq, allFreqs, allPsd);
    const harmPow = harm2Pow + harm3Pow;
    const harmonicRatio = fundPow > 0 ? (fundPow / (harmPow + 0.001)) : 0;

    const dispEst = estimateDisplacement(filtMag, fs);

    document.getElementById('repPatient').textContent = `Paciente: ${patId}`;
    document.getElementById('repMeta').textContent =
        `Tarefa: ${task} | Lado: ${side} | ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} | ${durationSec.toFixed(1)}s`;

    document.getElementById('repDomFreq').innerHTML =
        `${peakFreq.toFixed(1)} <span style="font-size:16px;">Hz</span>`;
    document.getElementById('repRelPower').innerHTML =
        `${relPower.toFixed(1)} <span style="font-size:16px;">%</span>`;
    setRing('repRelPowerRing', relPower, relPower > 60 ? 'var(--blue-700)' : 'var(--blue-500)');
    document.getElementById('repCentroid').innerHTML =
        `${centroid.toFixed(1)} <span style="font-size:16px;">Hz</span>`;
    document.getElementById('repHarmonic').textContent = harmonicRatio.toFixed(2);

    document.getElementById('repRMS').innerHTML =
        `${rmsVal.toFixed(3)} <span style="font-size:14px;">g</span>`;
    document.getElementById('repVariability').innerHTML =
        `${variab.toFixed(1)} <span style="font-size:14px;">%</span>`;
    document.getElementById('repOnTime').innerHTML =
        `${onTime.toFixed(1)} <span style="font-size:14px;">%</span> (limiar dinâmico: ${dynamicThreshold.toFixed(3)} g)`;

    let interpret = '';
    let freqLabel = '';
    if (task === 'Rest') {
        freqLabel = (peakFreq >= 3.5 && peakFreq <= 6.5) ? 'parkinsoniano (repouso)' :
            (peakFreq >= 6.5 && peakFreq <= 12) ? 'tremor essencial atípico' : 'atípico';
    } else if (task === 'Postural' || task === 'Kinetic' || task === 'Intentional') {
        freqLabel = (peakFreq >= 6.5 && peakFreq <= 12) ? 'tremor essencial (ação)' :
            (peakFreq >= 3.5 && peakFreq <= 6.5) ? 'parkinsoniano atípico' : 'atípico';
    } else {
        freqLabel = (peakFreq >= 3.5 && peakFreq <= 6.5) ? 'parkinsoniano' :
            (peakFreq >= 6.5 && peakFreq <= 12) ? 'tremor essencial' : 'atípico';
    }
    const severity = rmsVal < 0.05 ? 'leve' : (rmsVal < 0.15 ? 'moderado' : 'grave');
    const severityColor = severity === 'leve' ? 'badge-mild' : (severity === 'moderado' ? 'badge-moderate' :
        'badge-severe');

    interpret = `
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px;">
      <span class="badge-clinical ${severityColor}">${severity.toUpperCase()} amplitude</span>
      <span class="badge-clinical" style="background:var(--gray-200);color:var(--gray-700);">padrão ${freqLabel}</span>
      <span class="badge-clinical" style="background:var(--surface-sunken);color:var(--ink-500);border:1px solid var(--border);">
        ${relPower > 60 ? 'Alta especificidade em 3–8Hz' : 'Banda larga'}
      </span>
    </div>
    <div>
      <strong>Frequência dominante</strong> ${peakFreq.toFixed(1)} Hz 
      com ${relPower.toFixed(1)}% da potência na banda de 3–8 Hz. 
      ${relPower > 65 ? 'Este padrão é consistente com tremor de repouso parkinsoniano.' : 
        relPower > 40 ? 'Conteúdo de frequência mista — considerar tremor essencial ou tremor fisiológico exacerbado.' : 
        'Baixa especificidade — pode refletir movimento voluntário ou tremor de baixa amplitude.'}
      ${harmonicRatio > 1.8 ? 'Estrutura harmônica proeminente sugere oscilação sinusoidal.' : 'Baixa razão harmônica — forma de onda menos sinusoidal.'}
      ${variab > 40 ? '⚠️ Alta variabilidade de amplitude — pode indicar tremor intermitente ou reemergente.' : 'A amplitude está relativamente estável ao longo da gravação.'}
      <br><small style="color:var(--ink-400);">Tarefa: ${task} | Lado: ${side}</small>
    </div>
  `;
    document.getElementById('interpretText').innerHTML = interpret;

    const freqLabels = allFreqs.map(f => f.toFixed(1));
    psdChart.data.labels = freqLabels;
    psdChart.data.datasets[0].data = psdNorm;

    if (psdChart.options.plugins && psdChart.options.plugins.annotation &&
        psdChart.options.plugins.annotation.annotations &&
        psdChart.options.plugins.annotation.annotations.domLine) {
        psdChart.options.plugins.annotation.annotations.domLine.xMin = peakFreq;
        psdChart.options.plugins.annotation.annotations.domLine.xMax = peakFreq;
    }
    psdChart.update();

    resizeSpectrogram();
    renderSpectrogram(filtX, filtY, filtZ, fs);

    const sessionRecord = {
        id: Date.now(),
        patientId: patId,
        task,
        side,
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit',
            minute: '2-digit' }),
        duration: durationSec.toFixed(1),
        domFreq: peakFreq.toFixed(1),
        relPower: relPower.toFixed(1),
        centroid: centroid.toFixed(1),
        harmonic: harmonicRatio.toFixed(2),
        rms: rmsVal.toFixed(3),
        variability: variab.toFixed(1),
        onTime: onTime.toFixed(1),
        mad: madVal.toFixed(3),
        enmo: enmoVal.toFixed(3),
        disp: dispEst.toFixed(2),
        freqs: freqLabels,
        psd: psdNorm
    };

    savedSessions.unshift(sessionRecord);
    try {
        localStorage.setItem('steady_sessions', JSON.stringify(savedSessions));
        console.log('Sessão salva com sucesso:', sessionRecord);
    } catch (e) {
        console.warn('Erro ao salvar no localStorage:', e);
    }
    renderSessionTable();

    switchTab('report');
}

// ======================================================================
//  DISPLACEMENT ESTIMATION
// ======================================================================
function estimateDisplacement(signal, fs) {
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const ac = signal.map(v => v - mean);
    let vel = [0];
    for (let i = 1; i < ac.length; i++) {
        const dt = 1 / fs;
        vel.push(vel[i - 1] + (ac[i - 1] + ac[i]) / 2 * dt);
    }
    const vMean = vel.reduce((a, b) => a + b, 0) / vel.length;
    vel = vel.map(v => v - vMean);
    let disp = [0];
    for (let i = 1; i < vel.length; i++) {
        const dt = 1 / fs;
        disp.push(disp[i - 1] + (vel[i - 1] + vel[i]) / 2 * dt);
    }
    const dMean = disp.reduce((a, b) => a + b, 0) / disp.length;
    disp = disp.map(d => d - dMean);
    const win = Math.max(3, Math.floor(fs / 2));
    const smoothed = [];
    for (let i = 0; i < disp.length; i++) {
        let sum = 0,
            cnt = 0;
        for (let j = Math.max(0, i - win); j <= Math.min(disp.length - 1, i + win); j++) { sum += disp[j];
            cnt++; }
        smoothed.push(sum / cnt);
    }
    const hp = disp.map((d, i) => d - smoothed[i]);
    const peakDisp = Math.max(...hp.map(Math.abs));
    return peakDisp * 1000;
}

// ======================================================================
//  ESPECTROGRAMA
// ======================================================================
function renderSpectrogram(filtX, filtY, filtZ, fs) {
    resizeSpectrogram();
    const canvas = spectroCanvas;
    const ctx = spectroCtx;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width;
    const H = canvas.height;
    if (W === 0 || H === 0) {
        console.warn('Canvas do espectrograma com dimensão zero.');
        return;
    }

    ctx.fillStyle = '#10161D';
    ctx.fillRect(0, 0, W, H);

    const N = filtX.length;
    if (N < 64) {
        ctx.fillStyle = '#90A4B7';
        ctx.font = '14px sans-serif';
        ctx.fillText('Dados insuficientes para o espectrograma', 20, H / 2);
        return;
    }

    const segLen = Math.min(128, Math.floor(N / 6));
    const overlap = Math.floor(segLen * 0.75);
    const step = segLen - overlap;
    const nCols = Math.max(1, Math.floor((N - segLen) / step) + 1);
    if (nCols < 2 || segLen < 8) {
        ctx.fillStyle = '#90A4B7';
        ctx.font = '14px sans-serif';
        ctx.fillText('Poucos pontos temporais', 20, H / 2);
        return;
    }

    const maxFreq = 20;
    const nRows = Math.min(128, Math.floor(segLen / 2));
    const freqBins = [];
    for (let r = 0; r < nRows; r++) {
        const f = (r + 1) * (fs / segLen / 2);
        if (f > maxFreq) break;
        freqBins.push(f);
    }
    const nFreqBins = freqBins.length;
    if (nFreqBins < 2) {
        ctx.fillStyle = '#90A4B7';
        ctx.font = '14px sans-serif';
        ctx.fillText('Resolução insuficiente', 20, H / 2);
        return;
    }

    const matrix = [];
    const domFreqs = [];

    for (let col = 0; col < nCols; col++) {
        const start = col * step;
        const segX = filtX.slice(start, start + segLen);
        const segY = filtY.slice(start, start + segLen);
        const segZ = filtZ.slice(start, start + segLen);
        if (segX.length < segLen) break;

        const Nseg = segLen;
        const nFft = Math.pow(2, Math.ceil(Math.log2(Nseg)));
        const realX = new Float32Array(nFft),
            imagX = new Float32Array(nFft);
        const realY = new Float32Array(nFft),
            imagY = new Float32Array(nFft);
        const realZ = new Float32Array(nFft),
            imagZ = new Float32Array(nFft);
        for (let i = 0; i < Nseg; i++) {
            const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (Nseg - 1)));
            realX[i] = segX[i] * win;
            realY[i] = segY[i] * win;
            realZ[i] = segZ[i] * win;
        }
        fftRadix2(realX, imagX);
        fftRadix2(realY, imagY);
        fftRadix2(realZ, imagZ);

        const half = nFft / 2;
        const colData = [];
        let maxPwrCol = 0,
            peakFreqCol = 0;
        for (let r = 0; r < nFreqBins; r++) {
            const idx = r + 1;
            if (idx >= half) break;
            const pwr = (realX[idx] * realX[idx] + imagX[idx] * imagX[idx] +
                    realY[idx] * realY[idx] + imagY[idx] * imagY[idx] +
                    realZ[idx] * realZ[idx] + imagZ[idx] * imagZ[idx]) / nFft;
            colData.push(pwr);
            if (pwr > maxPwrCol) {
                maxPwrCol = pwr;
                peakFreqCol = freqBins[r];
            }
        }
        matrix.push(colData);
        domFreqs.push(peakFreqCol);
    }

    if (matrix.length < 2) {
        ctx.fillStyle = '#90A4B7';
        ctx.font = '14px sans-serif';
        ctx.fillText('Dados do espectrograma muito curtos', 20, H / 2);
        return;
    }

    let gmax = 0;
    for (const col of matrix)
        for (const v of col)
            if (v > gmax) gmax = v;
    if (gmax < 1e-12) gmax = 1;

    const w = matrix.length;
    const h = nFreqBins;
    const imgData = ctx.createImageData(W, H);
    const data = imgData.data;

    function colormap(val) {
        const v = Math.min(1, Math.max(0, val));
        const stops = [
            [0.0, 0.00, 0.00, 0.00],
            [0.1, 0.10, 0.00, 0.20],
            [0.3, 0.50, 0.00, 0.60],
            [0.5, 0.90, 0.30, 0.50],
            [0.7, 1.00, 0.70, 0.20],
            [0.9, 1.00, 0.95, 0.10],
            [1.0, 1.00, 1.00, 1.00]
        ];
        let i = 0;
        while (i < stops.length - 1 && stops[i + 1][0] < v) i++;
        if (i >= stops.length - 1) {
            const last = stops[stops.length - 1];
            return [last[1] * 255, last[2] * 255, last[3] * 255];
        }
        const t = (v - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        const r = stops[i][1] + (stops[i + 1][1] - stops[i][1]) * t;
        const g = stops[i][2] + (stops[i + 1][2] - stops[i][2]) * t;
        const b = stops[i][3] + (stops[i + 1][3] - stops[i][3]) * t;
        return [r * 255, g * 255, b * 255];
    }

    for (let py = 0; py < H; py++) {
        const fy = (py + 0.5) / H * h - 0.5;
        const y0 = Math.max(0, Math.floor(fy));
        const y1 = Math.min(h - 1, y0 + 1);
        const dy = fy - y0;
        for (let px = 0; px < W; px++) {
            const fx = (px + 0.5) / W * w - 0.5;
            const x0 = Math.max(0, Math.floor(fx));
            const x1 = Math.min(w - 1, x0 + 1);
            const dx = fx - x0;
            const v00 = matrix[x0] ? (matrix[x0][y0] || 0) : 0;
            const v01 = matrix[x0] ? (matrix[x0][y1] || 0) : 0;
            const v10 = matrix[x1] ? (matrix[x1][y0] || 0) : 0;
            const v11 = matrix[x1] ? (matrix[x1][y1] || 0) : 0;
            const val = (v00 * (1 - dx) + v10 * dx) * (1 - dy) +
                (v01 * (1 - dx) + v11 * dx) * dy;
            const norm = val / gmax;
            const [r, g, b] = colormap(norm);
            const idx = (py * W + px) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.scale(1 / dpr, 1 / dpr);
    const cssW = W / dpr;
    const cssH = H / dpr;

    ctx.fillStyle = '#90A4B7';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'bottom';
    const duration = N / fs;
    ctx.textAlign = 'left';
    ctx.fillText('0 s', 4, cssH - 2);
    ctx.textAlign = 'center';
    ctx.fillText((duration / 2).toFixed(1) + 's', cssW / 2, cssH - 2);
    ctx.textAlign = 'right';
    ctx.fillText(duration.toFixed(1) + 's', cssW - 4, cssH - 2);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('0 Hz', 2, 2);
    ctx.fillText('10 Hz', 2, cssH / 2 - 6);
    ctx.fillText('20 Hz', 2, cssH - 14);

    if (domFreqs.length > 5) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const xStep = cssW / domFreqs.length;
        for (let i = 0; i < domFreqs.length; i++) {
            const freq = domFreqs[i] || 0;
            const yPos = cssH - (freq / maxFreq) * cssH;
            const xPos = i * xStep + xStep / 2;
            if (i === 0) ctx.moveTo(xPos, yPos);
            else ctx.lineTo(xPos, yPos);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Freq. dominante', cssW - 4, 20);
    }

    ctx.restore();
}

// ======================================================================
//  FFT
// ======================================================================
function fftRadix2(real, imag) {
    const n = real.length;
    const log2n = Math.log2(n);
    if (!Number.isInteger(log2n)) return;
    for (let i = 0; i < n; i++) {
        let rev = 0;
        for (let j = 0; j < log2n; j++) rev = (rev << 1) | ((i >> j) & 1);
        if (rev > i) {
            let tr = real[i],
                ti = imag[i];
            real[i] = real[rev];
            imag[i] = imag[rev];
            real[rev] = tr;
            imag[rev] = ti;
        }
    }
    for (let s = 1; s <= log2n; s++) {
        const m = 1 << s,
            m2 = m >> 1;
        const wRe = Math.cos(-2 * Math.PI / m),
            wIm = Math.sin(-2 * Math.PI / m);
        for (let k = 0; k < n; k += m) {
            let uRe = 1,
                uIm = 0;
            for (let j = 0; j < m2; j++) {
                const tRe = uRe * real[k + j + m2] - uIm * imag[k + j + m2];
                const tIm = uRe * imag[k + j + m2] + uIm * real[k + j + m2];
                real[k + j + m2] = real[k + j] - tRe;
                imag[k + j + m2] = imag[k + j] - tIm;
                real[k + j] += tRe;
                imag[k + j] += tIm;
                const nuRe = uRe * wRe - uIm * wIm;
                uIm = uRe * wIm + uIm * wRe;
                uRe = nuRe;
            }
        }
    }
}

// ======================================================================
//  DATABASE
// ======================================================================
function renderSessionTable() {
    const tbody = document.getElementById('sessionTableBody');
    tbody.innerHTML = '';
    savedSessions.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td><input type="checkbox" class="session-select" value="${s.id}"></td>
      <td style="font-weight:600;">${s.patientId}</td>
      <td>${s.task} ${s.side||''}</td>
      <td>${s.domFreq} Hz</td>
      <td>${s.relPower}%</td>
      <td style="color:var(--text-muted);font-size:12px;">${s.date}</td>
    `;
        tbody.appendChild(tr);
    });
}

function clearDatabase() {
    if (confirm('Limpar todas as sessões armazenadas?')) {
        savedSessions = [];
        try {
            localStorage.removeItem('steady_sessions');
        } catch (e) { /* ignore */ }
        renderSessionTable();
        document.getElementById('comparisonMatrix').querySelector('tbody').innerHTML = '';
        compareChart.data.datasets = [];
        compareChart.update();
    }
}

function selectAllSessions() {
    document.querySelectorAll('.session-select').forEach(cb => cb.checked = true);
}

function renderComparison() {
    const ids = Array.from(document.querySelectorAll('.session-select:checked')).map(cb => Number(cb.value));
    const selected = savedSessions.filter(s => ids.includes(s.id));
    if (selected.length === 0) { alert('Selecione pelo menos uma sessão.'); return; }

    const colors = ['#1E7BAD', '#C43A44', '#86929E', '#4FA8DA', '#E0636B', '#172230'];
    compareChart.data.datasets = selected.map((s, i) => ({
        label: `${s.patientId} ${s.task}`,
        data: s.psd || [],
        borderColor: colors[i % colors.length],
        borderWidth: 2,
        pointRadius: 0
    }));
    compareChart.data.labels = selected[0].freqs || [];
    compareChart.update();

    const mHeader = document.getElementById('matrixHeader');
    const mBody = document.getElementById('matrixBody');
    mHeader.innerHTML = '<th>Métrica</th>' + selected.map(s =>
        `<th>${s.patientId}<br><small>${s.task}</small></th>`).join('');

    const rows = [
        { name: 'Freq. Dom. (Hz)', key: 'domFreq' },
        { name: 'Potência 3–8Hz (%)', key: 'relPower' },
        { name: 'Centroide (Hz)', key: 'centroid' },
        { name: 'Razão Harmônica', key: 'harmonic' },
        { name: 'RMS (g)', key: 'rms' },
        { name: 'Variabilidade (%)', key: 'variability' },
        { name: 'Tremor-ativo (%)', key: 'onTime' },
        { name: 'MAD (g)', key: 'mad' },
        { name: 'ENMO (g)', key: 'enmo' },
        { name: 'Desloc. (mm)', key: 'disp' }
    ];

    mBody.innerHTML = rows.map(r =>
        `<tr><td style="font-weight:600;color:var(--text-muted);">${r.name}</td>
     ${selected.map(s => `<td>${s[r.key] || '—'}</td>`).join('')}</tr>`
    ).join('');
}

// ======================================================================
//  EXPORTAR PNG
// ======================================================================
function exportReportImage() {
    const target = document.getElementById('reportContainer');
    psdChart.update();
    setTimeout(() => {
        html2canvas(target, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `STEADY_Relatorio_${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }).catch(err => {
            console.error('Erro ao exportar:', err);
            alert('Falha ao exportar. Tente novamente.');
        });
    }, 300);
}

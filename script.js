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
    // Inicializa contagem de brutos
    updateRawCountBadge();
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


// ======================================================================
//  ANÁLISE ESPECTRAL — CONFIGURAÇÃO DO SINAL RECEBIDO
//  Os valores fx/fy/fz já chegam FILTRADOS pelo firmware. O frontend
//  NÃO aplica um segundo filtro; apenas analisa o sinal recebido.
// ======================================================================
const ANALYSIS_CONFIG = Object.freeze({
    signalBand: {
        lowHz: 1.5,
        highHz: 15.0
    },

    // Banda operacional atual de análise.
    // Não representa uma definição fisiológica ou clínica universal.
    tremorBand: {
        lowHz: 2.0,
        highHz: 9.0
    },

    welch: {
        segmentSamples: 512,
        overlap: 0.50,
        fftSamples: 1024,
        maxFrequencyHz: 20.0
    },

    signalQuality: {
        minRmsG: 0.02
    },

    // Parâmetros de aquisição/validação, não de análise espectral.
    expectedFsHz: 128,
    fsWarnPct: 2,
    minDurationSec: 4
});

const ANALYSIS_VERSION = '5.0-welch-128hz-2to9';

// Estado USB
let usbPort = null;
let usbReader = null;
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
    updateRawCountBadge();
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
            x: {
                type: 'linear',
                min: ANALYSIS_CONFIG.signalBand.lowHz,
                max: ANALYSIS_CONFIG.signalBand.highHz,
                grid: { color: '#E9EDF2' },
                ticks: { color: '#6B7A8B' },
                title: { display: true, text: 'Frequência (Hz)', color: '#6B7A8B' }
            },
            y: {
                grid: { color: '#E9EDF2' },
                ticks: { color: '#6B7A8B' },
                title: { display: true, text: 'PSD (g²/Hz)', color: '#6B7A8B' },
                min: 0
            }
        }
    };

    if (annotationPluginAvailable) {
        psdOptions.plugins.annotation = {
            annotations: {
                tremorBand: {
                    type: 'box',
                    xMin: ANALYSIS_CONFIG.tremorBand.lowHz,
                    xMax: ANALYSIS_CONFIG.tremorBand.highHz,
                    yMin: 0,
                    yMax: 1,
                    backgroundColor: 'rgba(30,123,173,0.08)',
                    borderColor: 'rgba(30,123,173,0.3)',
                    borderWidth: 1,
                    label: {
                        content: `Banda operacional ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz`,
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
                    yMax: 1,
                    borderColor: '#C43A44',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    label: {
                        content: `Pico ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz`,
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
                tension: 0
            }]
        }
    });

    compareChart = new Chart(document.getElementById('compareChart'), {
        type: 'line',
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            plugins: { legend: { labels: { color: '#6B7A8B' } } },
            scales: {
                x: {
                    type: 'linear',
                    min: ANALYSIS_CONFIG.signalBand.lowHz,
                    max: ANALYSIS_CONFIG.welch.maxFrequencyHz,
                    grid: { color: '#E9EDF2' },
                    ticks: { color: '#6B7A8B' },
                    title: { display: true, text: 'Frequência (Hz)', color: '#6B7A8B' }
                },
                y: {
                    grid: { color: '#E9EDF2' },
                    ticks: { color: '#6B7A8B' },
                    min: 0,
                    title: { display: true, text: 'PSD (g²/Hz)', color: '#6B7A8B' }
                }
            }
        },
        data: { datasets: [] }
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

    const rms = Math.sqrt(fx * fx + fy * fy + fz * fz);
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
    console.log('[USB] connectUSB() chamada');
    if (!('serial' in navigator)) {
        alert('Web Serial API não suportada neste navegador. Use Chrome ou Edge.');
        return;
    }

    if (usbConnected) {
        console.log('[USB] Já conectado, desconectando...');
        await disconnectUSB();
        return;
    }

    try {
        console.log('[USB] Solicitando porta...');
        const port = await navigator.serial.requestPort();
        usbPort = port;
        console.log('[USB] Porta obtida:', port);

        console.log('[USB] Abrindo porta com baudRate 115200...');
        await port.open({
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'   // Evita DTR/RTS que podem resetar o ESP
        });
        console.log('[USB] Porta aberta com sucesso.');

        usbConnected = true;

        // ---- ATUALIZA UI ----
        document.getElementById('usbStatusDot').className = 'status-usb connected';
        document.getElementById('usbStatusText').textContent = 'USB Conectado';
        document.getElementById('connectUsbBtn').textContent = 'Desconectar USB';
        // USB permite iniciar gravação mesmo sem WS
        document.getElementById('startBtn').disabled = false;
        // ----------------------

        console.log('[USB] Obtendo reader...');
        const reader = port.readable.getReader();
        usbReader = reader;
        console.log('[USB] Reader criado, chamando readLoopUSB...');
        readLoopUSB(reader);
        console.log('[USB] readLoopUSB chamada (assíncrona).');

    } catch (err) {
        console.error('[USB] Erro em connectUSB:', err);
        alert('Falha ao conectar USB: ' + err.message);
        await disconnectUSB();
    }
}

async function disconnectUSB() {
    console.log('[USB] disconnectUSB chamado.');
    usbConnected = false;
    if (usbReader) {
        try {
            await usbReader.cancel();
            console.log('[USB] Reader cancelado.');
        } catch (e) {
            console.log('[USB] Erro ao cancelar reader:', e);
        }
        usbReader = null;
    }
    if (usbPort) {
        try {
            await usbPort.close();
            console.log('[USB] Porta fechada.');
        } catch (e) {
            console.log('[USB] Erro ao fechar porta:', e);
        }
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
    console.log('[USB] readLoopUSB iniciada');
    let buffer = new Uint8Array(0);
    const expectedLen = 28;
    let packetCount = 0;

    try {
        while (true) {
            console.log('[USB] Aguardando reader.read()...');
            const { value, done } = await reader.read();
            console.log('[USB] read() retornou:', { done, valueLength: value ? value.length : 0 });

            if (done) {
                console.warn('[USB] Stream finalizado (done=true). O ESP pode não estar enviando dados ou a porta foi fechada.');
                break;
            }
            if (!usbConnected) {
                console.log('[USB] usbConnected = false, saindo do loop.');
                break;
            }

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
                packetCount++;
                if (packetCount % 10 === 0) {
                    console.log('[USB] Pacotes processados até agora:', packetCount);
                }
            }
        }
    } catch (err) {
        if (err.name === 'CancelError') {
            console.log('[USB] CancelError capturado (cancelamento intencional).');
        } else {
            console.error('[USB] Erro em readLoopUSB:', err);
        }
    } finally {
        console.log('[USB] readLoopUSB finalizada');
        if (usbConnected) {
            console.log('[USB] Chamando disconnectUSB para limpar estado.');
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
        // --- SALVAR BRUTOS NO INDEXEDDB (Fase 1) ---
        const sessionId = Date.now();
        // Salva de forma assíncrona, sem bloquear a UI
        saveRawData(sessionId, recordBuffer).then(() => {
            // Após salvar, processa os dados e gera relatório
            processSessionData(sessionId);
            document.getElementById('exportBtn').disabled = false;
            updateRawCountBadge();
        }).catch(err => {
            console.error('Erro ao salvar brutos:', err);
            // Mesmo com erro, processa a sessão (sem brutos)
            processSessionData(sessionId);
            document.getElementById('exportBtn').disabled = false;
        });
    } else {
        alert('Gravação muito curta para análise espectral.');
    }
}

// ======================================================================
//  INDEXEDDB – RAW DATA STORAGE (Fase 1)
// ======================================================================
function openRawDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('STEADY_RawDB', 1);
        request.onupgradeneeded = (evt) => {
            const db = evt.target.result;
            if (!db.objectStoreNames.contains('raw_signals')) {
                db.createObjectStore('raw_signals', { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveRawData(sessionId, buffer) {
    const db = await openRawDB();
    const tx = db.transaction('raw_signals', 'readwrite');
    const store = tx.objectStore('raw_signals');
    const data = {
        id: sessionId,
        buffer: buffer // array de [ts, ax, ay, az, fx, fy, fz]
    };
    await new Promise((resolve, reject) => {
        const req = store.put(data);
        req.onsuccess = resolve;
        req.onerror = reject;
    });
    db.close();
}

async function getRawData(sessionId) {
    const db = await openRawDB();
    const tx = db.transaction('raw_signals', 'readonly');
    const store = tx.objectStore('raw_signals');
    const data = await new Promise((resolve, reject) => {
        const req = store.get(sessionId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = reject;
    });
    db.close();
    return data ? data.buffer : null;
}

async function deleteRawData(sessionId) {
    const db = await openRawDB();
    const tx = db.transaction('raw_signals', 'readwrite');
    const store = tx.objectStore('raw_signals');
    await new Promise((resolve, reject) => {
        const req = store.delete(sessionId);
        req.onsuccess = resolve;
        req.onerror = reject;
    });
    db.close();
}

async function countRawSessions() {
    const db = await openRawDB();
    const tx = db.transaction('raw_signals', 'readonly');
    const store = tx.objectStore('raw_signals');
    const count = await new Promise((resolve, reject) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = reject;
    });
    db.close();
    return count;
}

function updateRawCountBadge() {
    countRawSessions().then(cnt => {
        document.getElementById('rawCountBadge').textContent = `💾 Brutos: ${cnt}`;
    }).catch(err => console.warn('Erro ao contar brutos:', err));
}

// ======================================================================
//  CORE SIGNAL PROCESSING (mesmo código, com sessionId e UPDRS)
// ======================================================================
function integrateBandPower(freqs, psd, low, high) {
    if (!freqs || freqs.length < 2 || !psd || psd.length !== freqs.length) return 0;
    let area = 0;
    for (let i = 1; i < freqs.length; i++) {
        const f0 = freqs[i - 1], f1 = freqs[i];
        if (f1 <= low || f0 >= high || f1 <= f0) continue;
        const a = Math.max(f0, low);
        const b = Math.min(f1, high);
        if (b <= a) continue;
        const p0 = psd[i - 1], p1 = psd[i];
        const pa = p0 + (p1 - p0) * ((a - f0) / (f1 - f0));
        const pb = p0 + (p1 - p0) * ((b - f0) / (f1 - f0));
        area += 0.5 * (pa + pb) * (b - a);
    }
    return Math.max(0, area);
}

function weightedCentroid(freqs, psd, low, high) {
    if (!freqs || freqs.length < 2) return 0;
    let num = 0, den = 0;
    for (let i = 1; i < freqs.length; i++) {
        const f0 = freqs[i - 1], f1 = freqs[i];
        if (f1 <= low || f0 >= high || f1 <= f0) continue;
        const a = Math.max(f0, low), b = Math.min(f1, high);
        if (b <= a) continue;
        const p0 = psd[i - 1], p1 = psd[i];
        const pa = p0 + (p1 - p0) * ((a - f0) / (f1 - f0));
        const pb = p0 + (p1 - p0) * ((b - f0) / (f1 - f0));
        const da = 0.5 * (pa + pb) * (b - a);
        num += 0.5 * (a * pa + b * pb) * (b - a);
        den += da;
    }
    return den > 0 ? num / den : 0;
}

function meanOf(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function detrendMean(arr) {
    const m = meanOf(arr);
    return arr.map(v => v - m);
}

function computeWelchPSD3D(filtX, filtY, filtZ, fs) {
    const cfg = ANALYSIS_CONFIG;
    const N = filtX.length;
    const segLen = cfg.welch.segmentSamples;
    const step = Math.max(1, Math.round(segLen * (1 - cfg.welch.overlap)));
    if (N < segLen) {
        throw new Error(`A sessão precisa de pelo menos ${cfg.minDurationSec.toFixed(0)} s (${segLen} amostras) para a análise espectral padronizada.`);
    }

    const nfft = Math.max(cfg.welch.fftSamples, segLen);
    const half = Math.floor(nfft / 2);
    const window = new Float64Array(segLen);
    let sumW2 = 0;
    for (let i = 0; i < segLen; i++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (segLen - 1)));
        window[i] = w;
        sumW2 += w * w;
    }

    const sumPsd = new Float64Array(half + 1);
    let nSegs = 0;

    for (let start = 0; start + segLen <= N; start += step) {
        const x = detrendMean(filtX.slice(start, start + segLen));
        const y = detrendMean(filtY.slice(start, start + segLen));
        const z = detrendMean(filtZ.slice(start, start + segLen));
        const realX = new Float32Array(nfft), imagX = new Float32Array(nfft);
        const realY = new Float32Array(nfft), imagY = new Float32Array(nfft);
        const realZ = new Float32Array(nfft), imagZ = new Float32Array(nfft);

        for (let i = 0; i < segLen; i++) {
            realX[i] = x[i] * window[i];
            realY[i] = y[i] * window[i];
            realZ[i] = z[i] * window[i];
        }

        fftRadix2(realX, imagX);
        fftRadix2(realY, imagY);
        fftRadix2(realZ, imagZ);

        for (let k = 0; k <= half; k++) {
            const f = k * fs / nfft;
            if (f > cfg.welch.maxFrequencyHz) break;
            const px = realX[k] * realX[k] + imagX[k] * imagX[k];
            const py = realY[k] * realY[k] + imagY[k] * imagY[k];
            const pz = realZ[k] * realZ[k] + imagZ[k] * imagZ[k];
            let p = (px + py + pz) / (fs * sumW2);
            if (k > 0 && k < half) p *= 2; // espectro unilateral
            sumPsd[k] += p;
        }
        nSegs++;
    }

    const freqs = [];
    const psd = [];
    for (let k = 0; k <= half; k++) {
        const f = k * fs / nfft;
        if (f < cfg.signalBand.lowHz || f > cfg.welch.maxFrequencyHz) continue;
        freqs.push(f);
        psd.push(sumPsd[k] / Math.max(1, nSegs));
    }

    // A média de periodogramas é a estimativa de Welch. O valor abaixo
    // representa a energia espectral triaxial total, em g²/Hz.
    const totalPower = integrateBandPower(freqs, psd, cfg.signalBand.lowHz, cfg.signalBand.highHz);
    const tremorPower = integrateBandPower(freqs, psd, cfg.tremorBand.lowHz, cfg.tremorBand.highHz);
    const relativeTremorPower = totalPower > 0 ? 100 * tremorPower / totalPower : 0;
    const tremorRms = Math.sqrt(Math.max(0, tremorPower));

    let peakFreq = 0, peakPower = -Infinity;
    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] < cfg.tremorBand.lowHz || freqs[i] > cfg.tremorBand.highHz) continue;
        if (psd[i] > peakPower) {
            peakPower = psd[i];
            peakFreq = freqs[i];
        }
    }

    const centroid = weightedCentroid(freqs, psd, cfg.tremorBand.lowHz, cfg.tremorBand.highHz);
    const totalCentroid = weightedCentroid(freqs, psd, cfg.signalBand.lowHz, cfg.signalBand.highHz);

    function sumPowerNear(freq) {
        const width = Math.max(0.5, 2 * (freqs[1] - freqs[0]));
        return integrateBandPower(freqs, psd, Math.max(cfg.signalBand.lowHz, freq - width), Math.min(cfg.welch.maxFrequencyHz, freq + width));
    }
    const fundamentalPower = peakFreq > 0 ? sumPowerNear(peakFreq) : 0;
    const secondHarmonicPower = peakFreq > 0 ? sumPowerNear(2 * peakFreq) : 0;
    const thirdHarmonicPower = peakFreq > 0 ? sumPowerNear(3 * peakFreq) : 0;
    const harmonicRatio = fundamentalPower > 0 && (secondHarmonicPower + thirdHarmonicPower) > 0
        ? fundamentalPower / (secondHarmonicPower + thirdHarmonicPower)
        : null;

    const psdArea = totalPower > 0 ? totalPower : 1;
    const psdNormArea = psd.map(p => p / psdArea);

    return {
        freqs,
        psdRaw: psd,
        psdNorm: psdNormArea,
        // Compatibilidade com sessões/exportações anteriores.
        psd,
        psdNormArea,
        nSegs,
        segLen,
        nfft,
        df: fs / nfft,
        totalPower,
        tremorPower,
        tremorRms,
        relativeTremorPower,
        peakFreq,
        centroid,
        totalCentroid,
        harmonicRatio
    };
}

function processSessionData(sessionId) {
    const patId = document.getElementById('patientId').value.trim() || 'NÃO IDENTIFICADO';
    const task = document.getElementById('taskSelect').value;
    const side = document.getElementById('sideSelect').value;
    const updrs = parseFloat(document.getElementById('updrsInput').value) || 0;

    if (!recordBuffer || recordBuffer.length < ANALYSIS_CONFIG.welch.segmentSamples) {
        alert(`Dados insuficientes. Grave pelo menos ${ANALYSIS_CONFIG.minDurationSec} s para obter uma PSD de Welch padronizada.`);
        return;
    }

    const t0 = Number(recordBuffer[0][0]);
    const tN = Number(recordBuffer[recordBuffer.length - 1][0]);
    const durationSec = Math.max(0.1, (tN - t0) / 1000);
    const fs = (recordBuffer.length - 1) / durationSec;
    const fsDeviationPct = 100 * Math.abs(fs - ANALYSIS_CONFIG.expectedFsHz) / ANALYSIS_CONFIG.expectedFsHz;

    const filtX = recordBuffer.map(r => Number(r[4]) || 0);
    const filtY = recordBuffer.map(r => Number(r[5]) || 0);
    const filtZ = recordBuffer.map(r => Number(r[6]) || 0);

    _lastFiltX = filtX;
    _lastFiltY = filtY;
    _lastFiltZ = filtZ;
    _lastFs = fs;

    // Os dados filtrados já chegam do firmware. Não há refiltragem aqui.
    const meanX = meanOf(filtX), meanY = meanOf(filtY), meanZ = meanOf(filtZ);
    const acX = filtX.map(v => v - meanX);
    const acY = filtY.map(v => v - meanY);
    const acZ = filtZ.map(v => v - meanZ);
    const vectorMag = acX.map((_, i) => Math.sqrt(acX[i]**2 + acY[i]**2 + acZ[i]**2));

    // RMS do sinal filtrado completo (1,5–15 Hz), separado do RMS da banda operacional.
    const filteredRmsVal = Math.sqrt(meanOf(
        filtX.map((_, i) => filtX[i]**2 + filtY[i]**2 + filtZ[i]**2)
    ));
    const madVal = meanOf(vectorMag.map(v => Math.abs(v - meanOf(vectorMag))));

    const rawX = recordBuffer.map(r=>Number(r[1]) || 0);
    const rawY = recordBuffer.map(r=>Number(r[2]) || 0);
    const rawZ = recordBuffer.map(r=>Number(r[3]) || 0);
    const rawMag = rawX.map((_,i)=>Math.sqrt(rawX[i]**2+rawY[i]**2+rawZ[i]**2));
    const meanRaw = meanOf(rawMag);
    const enmoVal = Math.max(0, meanRaw - 1.0);

    const envelope = vectorMag;
    const meanEnv = meanOf(envelope);
    const stdEnv = Math.sqrt(meanOf(envelope.map(v => (v-meanEnv)**2)));
    const variab = meanEnv > 0 ? (stdEnv/meanEnv)*100 : 0;
    const medianMag = [...vectorMag].sort((a,b)=>a-b)[Math.floor(vectorMag.length/2)] || 0;
    const madMag = meanOf(vectorMag.map(v=>Math.abs(v-medianMag)));
    const dynamicThreshold = Math.max(0.02, 2*madMag);
    const onTime = meanOf(vectorMag.map(v => v > dynamicThreshold ? 1 : 0))*100;

    let spectral;
    try {
        spectral = computeWelchPSD3D(filtX, filtY, filtZ, fs);
    } catch (err) {
        alert(err.message || 'Não foi possível calcular a PSD.');
        return;
    }

    const {
        freqs, psdRaw, psdNorm, nSegs, segLen, nfft, df,
        totalPower, tremorPower, tremorRms, relativeTremorPower,
        peakFreq, centroid, totalCentroid, harmonicRatio
    } = spectral;
    const psd = psdRaw;

    const isSpectrallyUsable = totalPower > 0 && tremorPower > 0;
    const signalQualityOk = filteredRmsVal >= ANALYSIS_CONFIG.signalQuality.minRmsG;
    const freqLabels = freqs.map(f => f.toFixed(3));
    const samplingWarning = fsDeviationPct > ANALYSIS_CONFIG.fsWarnPct;

    // ---------- ATUALIZA UI ----------
    document.getElementById('repPatient').textContent = `Paciente: ${patId} (UPDRS: ${updrs})`;
    document.getElementById('repMeta').textContent =
        `Tarefa: ${task} | Lado: ${side} | ${durationSec.toFixed(1)} s | fs medido: ${fs.toFixed(2)} Hz | filtro recebido: ${ANALYSIS_CONFIG.signalBand.lowHz}–${ANALYSIS_CONFIG.signalBand.highHz} Hz`;

    document.getElementById('repDomFreq').innerHTML = isSpectrallyUsable
        ? `${peakFreq.toFixed(2)} <span style="font-size:16px;">Hz</span>` : '—';
    document.getElementById('repRelPower').innerHTML = isSpectrallyUsable
        ? `${relativeTremorPower.toFixed(1)} <span style="font-size:14px;">%</span>` : '—';
    setRing('repRelPowerRing', isSpectrallyUsable ? relativeTremorPower : 0,
        relativeTremorPower > 50 ? 'var(--blue-700)' : 'var(--blue-500)');
    document.getElementById('repCentroid').innerHTML = isSpectrallyUsable
        ? `${centroid.toFixed(2)} <span style="font-size:16px;">Hz</span>` : '—';
    document.getElementById('repHarmonic').textContent = harmonicRatio == null ? '—' : harmonicRatio.toFixed(2);
    const bandPowerEl = document.getElementById('repBandPower');
    if (bandPowerEl) bandPowerEl.innerHTML = `${tremorPower.toFixed(6)} <span style="font-size:13px;">g²</span>`;
    document.getElementById('repRMS').innerHTML = `${tremorRms.toFixed(4)} <span style="font-size:14px;">g</span>`;
    const filteredRmsEl = document.getElementById('repFilteredRMS');
    if (filteredRmsEl) filteredRmsEl.innerHTML = `${filteredRmsVal.toFixed(4)} <span style="font-size:14px;">g</span>`;
    document.getElementById('repVariability').innerHTML = `${variab.toFixed(1)} <span style="font-size:14px;">%</span>`;
    document.getElementById('repOnTime').innerHTML = `${onTime.toFixed(1)} <span style="font-size:14px;">%</span>`;

    let interpret = `
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <span class="badge-clinical" style="background:var(--blue-100);color:var(--blue-700);">ANÁLISE QUANTITATIVA</span>
          <span class="badge-clinical" style="background:var(--gray-200);color:var(--gray-700);">Welch ${segLen} amostras / ${(ANALYSIS_CONFIG.welch.overlap * 100).toFixed(0)}% overlap • NFFT ${nfft}</span>
          <span class="badge-clinical" style="background:var(--surface-sunken);color:var(--ink-500);border:1px solid var(--border);">Δf = ${df.toFixed(3)} Hz</span>
        </div>
        <div>
          <strong>Potência ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz:</strong> ${tremorPower.toFixed(6)} g²<br>
          <strong>RMS ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz:</strong> ${tremorRms.toFixed(4)} g<br>
          <strong>Frequência dominante ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz:</strong> ${isSpectrallyUsable ? peakFreq.toFixed(2) + ' Hz' : 'não determinada'}<br>
          <strong>Potência relativa ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz:</strong> ${relativeTremorPower.toFixed(1)}% da potência ${ANALYSIS_CONFIG.signalBand.lowHz}–${ANALYSIS_CONFIG.signalBand.highHz} Hz.
          ${samplingWarning ? `<br><span style="color:var(--red-600);"><strong>⚠️ Atenção:</strong> fs medido difere ${fsDeviationPct.toFixed(1)}% do esperado (${ANALYSIS_CONFIG.expectedFsHz} Hz). Verifique o timestamp/firmware antes de comparar sessões.</span>` : ''}
          <br><small style="color:var(--ink-400);">Estas métricas descrevem quantitativamente o sinal registrado e não constituem diagnóstico ou classificação clínica.</small>
        </div>`;
    document.getElementById('interpretText').innerHTML = interpret;

    // ---------- GRÁFICO PSD ABSOLUTA ----------
    psdChart.data.datasets[0].data = freqs.map((f, i) => ({x: f, y: psd[i]}));
    psdChart.data.datasets[0].label = 'PSD triaxial — Welch';
    psdChart.options.scales.y.title.text = 'PSD (g²/Hz)';
    psdChart.options.scales.x.min = ANALYSIS_CONFIG.signalBand.lowHz;
    psdChart.options.scales.x.max = ANALYSIS_CONFIG.welch.maxFrequencyHz;
    if (psdChart.options.plugins?.annotation?.annotations?.domLine) {
        psdChart.options.plugins.annotation.annotations.domLine.xMin = peakFreq || ANALYSIS_CONFIG.tremorBand.lowHz;
        psdChart.options.plugins.annotation.annotations.domLine.xMax = peakFreq || ANALYSIS_CONFIG.tremorBand.lowHz;
        psdChart.options.plugins.annotation.annotations.domLine.display = isSpectrallyUsable;
    }
    psdChart.update();

    resizeSpectrogram();
    renderSpectrogram(filtX, filtY, filtZ, fs);

    // ---------- SALVA SESSÃO ----------
    const sessionRecord = {
        id: sessionId,
        analysisVersion: ANALYSIS_VERSION,
        patientId: patId,
        task,
        side,
        updrs,
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        duration: durationSec.toFixed(1),
        fs: fs.toFixed(3),
        fsExpected: ANALYSIS_CONFIG.expectedFsHz,
        fsDeviationPct: fsDeviationPct.toFixed(2),
        analysisConfig: structuredClone(ANALYSIS_CONFIG),
        sampleCount: recordBuffer.length,
        sampleRateHz: fs,
        filterLowHz: ANALYSIS_CONFIG.signalBand.lowHz,
        filterHighHz: ANALYSIS_CONFIG.signalBand.highHz,
        tremorLowHz: ANALYSIS_CONFIG.tremorBand.lowHz,
        tremorHighHz: ANALYSIS_CONFIG.tremorBand.highHz,
        nperseg: segLen,
        noverlap: Math.round(ANALYSIS_CONFIG.welch.segmentSamples * ANALYSIS_CONFIG.welch.overlap),
        nfft,
        df: df.toFixed(5),
        domFreq: isSpectrallyUsable ? peakFreq.toFixed(2) : '—',
        tremorPower: tremorPower.toFixed(8),
        tremorRMS: tremorRms.toFixed(5),
        relPower: isSpectrallyUsable ? relativeTremorPower.toFixed(2) : '—',
        centroid: isSpectrallyUsable ? centroid.toFixed(2) : '—',
        totalCentroid: totalCentroid.toFixed(2),
        harmonic: harmonicRatio == null ? '—' : harmonicRatio.toFixed(3),
        rms: filteredRmsVal.toFixed(5),
        variability: variab.toFixed(1),
        onTime: onTime.toFixed(1),
        mad: madVal.toFixed(5),
        enmo: enmoVal.toFixed(5),
        freqs: freqLabels,
        psdRaw,
        psdNorm,
        psdDensity: psdRaw,
        psdNormArea: psdNorm,
        psd: psdRaw, // compatibilidade com exportações anteriores
        rawDataStorage: 'IndexedDB',
        filteredDataIncludedInRaw: true,
        hasRaw: true
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
//  DATABASE (localStorage + IndexedDB)
// ======================================================================
function renderSessionTable() {
    const tbody = document.getElementById('sessionTableBody');
    tbody.innerHTML = '';
    savedSessions.forEach(s => {
        const tr = document.createElement('tr');
        const rawIcon = s.hasRaw ? '💾' : '🚫';
        tr.innerHTML = `
      <td><input type="checkbox" class="session-select" value="${s.id}"></td>
      <td style="font-weight:600;">${s.patientId} <span class="raw-badge">${rawIcon}</span></td>
      <td>${s.task} ${s.side||''}</td>
      <td>${s.domFreq} Hz</td>
      <td>${s.relPower}%</td>
      <td style="color:var(--text-muted);font-size:12px;">${s.date}</td>
    `;
        tbody.appendChild(tr);
    });
}

function clearDatabase() {
    if (confirm('Limpar todas as sessões armazenadas? Isso também removerá os dados brutos.')) {
        // Remove todos os brutos do IndexedDB
        savedSessions.forEach(async s => {
            if (s.hasRaw) {
                await deleteRawData(s.id).catch(e => console.warn('Erro ao deletar bruto:', e));
            }
        });
        savedSessions = [];
        try {
            localStorage.removeItem('steady_sessions');
        } catch (e) { /* ignore */ }
        renderSessionTable();
        document.getElementById('comparisonMatrix').querySelector('tbody').innerHTML = '';
        compareChart.data.datasets = [];
        compareChart.update();
        updateRawCountBadge();
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
    const spectral = selected.filter(s => s.analysisVersion === ANALYSIS_VERSION && Array.isArray(s.psdRaw) && Array.isArray(s.freqs));
    const legacy = selected.length - spectral.length;

    compareChart.data.datasets = spectral.map((s, i) => ({
        label: `${s.patientId} • ${s.task}`,
        data: s.freqs.map((f, k) => ({ x: Number(f), y: Number(s.psdRaw[k]) })),
        borderColor: colors[i % colors.length],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0
    }));
    compareChart.update();

    const mHeader = document.getElementById('matrixHeader');
    const mBody = document.getElementById('matrixBody');
    mHeader.innerHTML = '<th>Métrica</th>' + selected.map(s =>
        `<th>${s.patientId}<br><small>${s.task}${s.analysisVersion === ANALYSIS_VERSION ? '' : ' · legado'}</small></th>`).join('');

    const rows = [
        { name: 'UPDRS', key: 'updrs' },
        { name: `Freq. dominante ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz (Hz)`, key: 'domFreq' },
        { name: `Potência ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz (g²)`, key: 'tremorPower' },
        { name: `RMS ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz (g)`, key: 'tremorRMS' },
        { name: `Potência relativa ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz (%)`, key: 'relPower' },
        { name: `Centroide ${ANALYSIS_CONFIG.tremorBand.lowHz}–${ANALYSIS_CONFIG.tremorBand.highHz} Hz (Hz)`, key: 'centroid' },
        { name: 'Razão harmônica', key: 'harmonic' },
        { name: 'RMS total filtrado 1,5–15 Hz (g)', key: 'rms' },
        { name: 'Variabilidade do envelope (%)', key: 'variability' },
        { name: 'Atividade acima do limiar (%)', key: 'onTime' },
        { name: 'MAD (g)', key: 'mad' },
        { name: 'ENMO (g)', key: 'enmo' },
        { name: 'fs medido (Hz)', key: 'fs' }
    ];

    mBody.innerHTML = rows.map(r =>
        `<tr><td style="font-weight:600;color:var(--text-muted);">${r.name}</td>
     ${selected.map(s => `<td>${s[r.key] !== undefined ? s[r.key] : '—'}</td>`).join('')}</tr>`
    ).join('');

    if (legacy > 0) {
        const warning = document.getElementById('comparisonWarning');
        if (warning) {
            warning.textContent = `${legacy} sessão(ões) legadas não foram incluídas na sobreposição de PSD. Elas usam uma versão anterior da análise e não são quantitativamente comparáveis à PSD Welch atual.`;
            warning.classList.remove('hidden');
        }
    } else {
        const warning = document.getElementById('comparisonWarning');
        if (warning) warning.classList.add('hidden');
    }
}

// ======================================================================
//  EXPORTAR EXCEL (Fase 2.1)
// ======================================================================
async function exportExcel() {
    const ids = Array.from(document.querySelectorAll('.session-select:checked')).map(cb => Number(cb.value));
    const selected = savedSessions.filter(s => ids.includes(s.id));
    if (selected.length === 0) { alert('Selecione pelo menos uma sessão.'); return; }

    const summaryRows = selected.map(s => ({
        'ID': s.id,
        'Versão da análise': s.analysisVersion || 'legado',
        'Paciente': s.patientId,
        'Tarefa': s.task,
        'Lado': s.side || '',
        'UPDRS': s.updrs || 0,
        'Data': s.date,
        'Duração (s)': s.duration,
        'Amostras': s.sampleCount ?? '',
        'fs medido (Hz)': s.sampleRateHz ?? s.fs ?? '',
        'fs esperado (Hz)': s.fsExpected || '',
        'Desvio fs (%)': s.fsDeviationPct || '',
        'Filtro recebido (Hz)': `${s.filterLowHz ?? ''}-${s.filterHighHz ?? ''}`,
        'Banda tremor (Hz)': `${s.tremorLowHz ?? ''}-${s.tremorHighHz ?? ''}`,
        'Welch (amostras)': s.nperseg ?? '',
        'Welch (overlap)': s.noverlap != null ? `${((s.noverlap / Math.max(1, s.nperseg)) * 100).toFixed(1)}%` : '',
        'NFFT': s.nfft ?? '',
        'Δf (Hz)': s.df ?? '',
        [`Freq. dominante ${ANALYSIS_CONFIG.tremorBand.lowHz}-${ANALYSIS_CONFIG.tremorBand.highHz} Hz (Hz)`]: s.domFreq,
        [`Potência ${ANALYSIS_CONFIG.tremorBand.lowHz}-${ANALYSIS_CONFIG.tremorBand.highHz} Hz (g²)`]: s.tremorPower,
        [`RMS ${ANALYSIS_CONFIG.tremorBand.lowHz}-${ANALYSIS_CONFIG.tremorBand.highHz} Hz (g)`]: s.tremorRMS,
        [`Potência relativa ${ANALYSIS_CONFIG.tremorBand.lowHz}-${ANALYSIS_CONFIG.tremorBand.highHz} Hz (%)`]: s.relPower,
        [`Centroide ${ANALYSIS_CONFIG.tremorBand.lowHz}-${ANALYSIS_CONFIG.tremorBand.highHz} Hz (Hz)`]: s.centroid,
        'Centroide 1,5-15 Hz (Hz)': s.totalCentroid,
        'Razão harmônica': s.harmonic,
        'RMS total filtrado 1,5-15 Hz (g)': s.rms,
        'Variabilidade (%)': s.variability,
        'Atividade acima do limiar (%)': s.onTime,
        'MAD (g)': s.mad,
        'ENMO (g)': s.enmo
    }));

    const spectral = selected.filter(s => s.analysisVersion === ANALYSIS_VERSION && Array.isArray(s.psdRaw));
    const maxLen = Math.max(0, ...spectral.map(s => s.psdRaw.length));
    const specRows = [];
    for (let i = 0; i < maxLen; i++) {
        const row = { 'Freq. (Hz)': spectral[0]?.freqs?.[i] ?? '' };
        spectral.forEach(s => {
            row[`${s.patientId} (${s.task}) PSD (g²/Hz)`] = s.psdRaw?.[i] ?? '';
        });
        specRows.push(row);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Resumo');
    if (specRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(specRows), 'PSD Welch');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `STEADY_Export_${Date.now()}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// ======================================================================
//  EXPORTAR CSV (Fase 2.2)
// ======================================================================
async function exportCSV() {
    const ids = Array.from(document.querySelectorAll('.session-select:checked')).map(cb => Number(cb.value));
    let selected = savedSessions.filter(s => ids.includes(s.id));
    if (selected.length === 0) { alert('Selecione pelo menos uma sessão.'); return; }

    // Verifica se todas as sessões selecionadas possuem dados brutos
    const missing = selected.filter(s => !s.hasRaw);
    if (missing.length > 0) {
        const msg = `As seguintes sessões não possuem dados brutos (foram gravadas antes da atualização):\n${missing.map(s => `${s.patientId} (${s.task})`).join('\n')}\n\nDeseja continuar exportando apenas as que possuem dados?`;
        if (!confirm(msg)) return;
        // Filtra apenas as que têm raw
        const hasRawSelected = selected.filter(s => s.hasRaw);
        if (hasRawSelected.length === 0) {
            alert('Nenhuma das selecionadas possui dados brutos.');
            return;
        }
        // Atualiza a lista para apenas as que têm raw
        selected = hasRawSelected;
    }

    // Coleta os dados brutos do IndexedDB
    let allRows = [];
    for (const s of selected) {
        const buffer = await getRawData(s.id);
        if (!buffer) {
            console.warn(`Dados brutos não encontrados para sessão ${s.id}`);
            continue;
        }
        // buffer é um array de [ts, ax, ay, az, fx, fy, fz]
        const rows = buffer.map(row => ({
            session_id: s.id,
            patient: s.patientId,
            task: s.task,
            side: s.side || '',
            updrs: s.updrs ?? '',
            timestamp: row[0],
            ax: row[1],
            ay: row[2],
            az: row[3],
            fx: row[4],
            fy: row[5],
            fz: row[6]
        }));
        allRows = allRows.concat(rows);
    }

    if (allRows.length === 0) {
        alert('Nenhum dado bruto encontrado para exportar.');
        return;
    }

    // Converte para CSV
    const headers = ['session_id', 'patient', 'task', 'side', 'updrs', 'timestamp', 'ax', 'ay', 'az', 'fx', 'fy', 'fz'];
    let csv = headers.join(',') + '\n';
    for (const row of allRows) {
        const vals = headers.map(h => row[h] ?? '');
        csv += vals.join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `STEADY_Raw_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// ======================================================================
//  EXCLUIR BRUTOS SELECIONADOS (Fase 4)
// ======================================================================
async function deleteSelectedRaw() {
    const ids = Array.from(document.querySelectorAll('.session-select:checked')).map(cb => Number(cb.value));
    const selected = savedSessions.filter(s => ids.includes(s.id) && s.hasRaw);
    if (selected.length === 0) {
        alert('Nenhuma sessão com dados brutos selecionada.');
        return;
    }
    if (!confirm(`Tem certeza que deseja excluir os dados brutos de ${selected.length} sessão(ões)? Esta ação não pode ser desfeita.`)) return;

    for (const s of selected) {
        await deleteRawData(s.id);
        s.hasRaw = false;
    }
    // Atualiza localStorage
    try {
        localStorage.setItem('steady_sessions', JSON.stringify(savedSessions));
    } catch (e) { /* ignore */ }
    renderSessionTable();
    updateRawCountBadge();
    alert('Dados brutos removidos com sucesso.');
}

// ======================================================================
//  EXPORTAR PNG (mantido)
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
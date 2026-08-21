# Steady – Ferramenta de Avaliação de Tremor

**Steady** é um sistema portátil e de baixo custo para avaliação quantitativa de tremor.  
Combina um **sensor vestível ESP32‑S3** com um **painel web autocontido** que captura, visualiza e analisa dados acelerométricos durante manobras clínicas padronizadas (repouso, postural, cinético, intencional).  

Todo o processamento de sinais – de **PSD de Welch** a **espectrogramas** e **métricas interpretativas** – é executado no navegador, sem necessidade de **servidor backend** nem **instalação**. Os dados são armazenados localmente (`IndexedDB` + `localStorage`) e podem ser exportados para fins de pesquisa (Excel, CSV, PNG).

<img width="800" height="450" alt="STEADYSistemadeAnlisedeTremorv5 0PSDWelchMozillaFirefox2026-08-2109-11-02-Trim-ezgif com-video-to-gif-converter" src="https://github.com/user-attachments/assets/4105f55d-105b-41d3-98a5-cd1ed321fc1c" />


---

## Visão Geral do Sistema

```
┌────────────────────────────────────────────────────────────────────┐
│                ESP32‑S3 (Sensor Vestível)                          │
│  • Acelerômetro QMI8658 @ 128 Hz                                   │
│  • Filtro passa‑faixa em hardware 1,5–15 Hz (Butterworth ordem 4)  │
│  • Display TFT: formas de onda com rolagem + barra de amplitude    │
│  • Servidor WebSocket (modos AP + STA)                             │
│  • Transmissão binária via Wi‑Fi **e** USB‑Serial                  │
│  • Formato do pacote: 28 bytes (timestamp + 3 brutos + 3 filtrados)│
└────────────────────────────┬───────────────────────────────────────┘
                             │ Wi‑Fi / WebSocket  ou  USB‑Serial
                             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                Navegador Web (Frontend + Análise)                          │
│  • Conexão WebSocket ou Web Serial                                         │
│  • Gráficos ao vivo (bruto e filtrado)                                     │
│  • Controle de gravação com metadados de tarefa/UPDRS                      │
│  • Dados brutos armazenados no IndexedDB (para reanálise posterior)        │
│  • PSD de Welch (segmentos de 512 amostras, 50% de sobreposição, NFFT 1024)│
│  • Espectrograma tempo‑frequência                                          │
│  • Métricas quantitativas: RMS, potência relativa, centroide,              │
│    razão harmônica, variabilidade, atividade de cruzamento de limiar       │
│  • Relatório interpretativo com selos de gravidade                         │
│  • Banco de sessões + sobreposição de comparação                           │
│  • Exportações: PNG (relatório), Excel (resumo + PSD),                     │
│    CSV (dados brutos)                                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Recursos

- **Streaming em tempo real** – gráficos ao vivo da aceleração triaxial bruta e filtrada.
- **Conectividade dupla** – conecte via Wi‑Fi (WebSocket) **ou** USB‑Serial (Web Serial API).
- **Análise offline** – após a gravação, o painel calcula:
  - **Densidade Espectral de Potência** (método de Welch)
  - **Frequência dominante** e **potência relativa** na banda de 2–9 Hz
  - **Centroide espectral** e **razão harmônica**
  - **Variabilidade de amplitude** e **atividade de cruzamento de limiar** (limiar MAD adaptativo)
  - **Espectrograma tempo‑frequência** com sobreposição da frequência dominante
- **Relatório interpretativo** – resumo quantitativo com interpretação textual (classificação leve/moderada/grave).
- **Banco de dados local** – todas as sessões armazenadas em `localStorage` (metadados) e `IndexedDB` (dados brutos).
- **Modo de comparação** – sobreponha PSDs de várias sessões e compare métricas lado a lado.
- **Exportações**:
  - **PNG** – imagem completa do relatório.
  - **Excel (.xlsx)** – planilha de resumo + planilha de PSD para todas as sessões selecionadas.
  - **CSV** – dados triaxiais brutos para validação externa.

---

## Requisitos de Hardware

- **Placa:** Waveshare ESP32‑S3‑Touch‑LCD‑1.69 (display ST7789V2, touch CST816T, PMU AXP2101)
- **IMU:** QMI8658 integrado (endereço I²C `0x6B`)
- **Alimentação:** USB‑C ou bateria Li‑ion (gerenciada pelo AXP2101)
- **Pinagem:** definida em `Config.h` – verifique com a revisão da sua placa.

---

## Conteúdo do Repositório

```text
Steady/
├── Firmware/                          # Firmware ESP32‑S3
│   ├── Config.h                       # Mapeamento de pinos, coeficientes do filtro, credenciais Wi‑Fi
│   ├── DSPPipeline.cpp                # Cascata biquad (Butterworth passa‑faixa 1,5–15 Hz) + envelope
│   ├── DSPPipeline.h                  # Cabeçalho do pipeline DSP
│   ├── DisplayManager.cpp             # Renderização de formas de onda no TFT
│   ├── DisplayManager.h               # Cabeçalho do gerenciador de display
│   ├── NetworkManager.cpp             # Servidor WebSocket, transmissão binária, tratamento de comandos
│   ├── NetworkManager.h               # Cabeçalho do gerenciador de rede
│   ├── QMI8658Sensor.cpp              # Implementação do driver do IMU QMI8658
│   ├── QMI8658Sensor.h                # Cabeçalho do driver do IMU QMI8658
│   ├── TremorSensor.h                 # Abstração do sensor
│   ├── steady_firmware.ino            # Sketch Arduino principal (FreeRTOS dual‑core)
│   └── Fonts/                         # Fontes personalizadas para o display TFT
├── index.html                         # Interface do painel – estrutura e estilos
├── script.js                          # Toda a lógica do lado do cliente – conexão, DSP, BD, exportações
├── README.md                          # Este documento (Inglês)
├── README-PTBR.md                     # Versão em português
└── LICENSE                            # Licença MIT
```

---

## Configuração do Firmware

1. **Configure `Config.h`**
   - Defina `WIFI_STA_SSID` e `WIFI_STA_PASSWORD` para a sua rede.
   - Se o STA falhar, o dispositivo entra em modo AP (SSID `Steady-Device`, senha `steadyadmin`).
   - **Não altere** os coeficientes SOS pré‑computados (validados para 1,5–15 Hz, ordem 4, 128 Hz).

2. **Instale as bibliotecas Arduino necessárias**
   - `Arduino_GFX`
   - `SensorQMI8658`
   - `WiFi` / `ESPmDNS` / `ESPAsyncWebServer`

3. **Compile e envie** – selecione **ESP32S3 Dev Module** no Arduino IDE / PlatformIO.

Após iniciar, o TFT mostra o endereço IP (ou SSID do AP). O dispositivo começa a transmitir imediatamente.

---

## Usando o Painel Clínico

### 1. Abra o Painel
Basta abrir `index.html` no **Chrome**, **Edge** ou **Firefox** – nenhum servidor web é necessário.

### 2. Conecte-se ao Sensor
- **Wi‑Fi (WebSocket):** Digite o endereço IP do ESP32 (ex.: `192.168.0.140`) e clique em **Connect WS**.
- **USB (Serial):** Clique em **Connect USB** e selecione a porta serial do ESP32 na janela do navegador.

O ponto de status fica verde quando conectado. O botão **Start Recording** fica ativo.

### 3. Defina Paciente, UPDRS e Tarefa
Preencha o ID do paciente, escore UPDRS (opcional), tipo de tarefa (Repouso / Postural / Cinético / Intencional) e lado afetado. Esses metadados são salvos em cada sessão.

### 4. Grave uma Sessão
- Clique em **Start Recording** – os dados começam a se acumular no buffer do navegador.
- Realize a manobra clínica (ex.: braços em repouso, estendidos, dedo‑nariz).
- Clique em **Stop Recording** – os dados brutos são salvos no `IndexedDB` e o **processamento offline** inicia automaticamente.
- A aba **Analysis** abre, exibindo o gráfico de PSD, espectrograma, cartões de métricas e o texto interpretativo.

### 5. Explore as Sessões Salvas
- A aba **Database & Comparison** lista todas as sessões.
- Selecione várias sessões para:
  - **Sobrepor curvas de PSD** no gráfico de comparação.
  - **Comparar métricas** em uma matriz lado a lado.
  - **Exportar** dados processados (Excel) ou brutos (CSV) das sessões selecionadas.

### 6. Exportar
- **PNG:** Clique em **Export PNG** para salvar o relatório atual como imagem.
- **Excel:** Exporta uma planilha de resumo com todas as métricas e uma planilha de PSD (uma coluna por frequência, uma linha por sessão).
- **CSV:** Exporta amostras triaxiais brutas das sessões selecionadas (timestamp, ax, ay, az, fx, fy, fz).

---

## Estrutura do Código – `script.js` (Funções Principais)

Toda a lógica do lado do cliente está contida em `script.js`. Está organizada em grupos funcionais claros.

### Integração e Inicialização
| Função | Descrição |
|--------|-----------|
| `DOMContentLoaded` | Mostra/oculta o modal de integração com base na flag do `localStorage`. |
| `window.onload` | Inicializa os gráficos, verifica o suporte a Web Serial, dimensiona o canvas do espectrograma. |
| `initCharts()` | Instancia os 4 gráficos do Chart.js (bruto, filtrado, PSD, comparação). |

### Auxiliares de UI
| Função | Descrição |
|--------|-----------|
| `setRing(id, pct, color)` | Atualiza um medidor circular via propriedades personalizadas CSS. |
| `updateFilteredScale()` | Alterna escala automática/fixa do eixo Y para o gráfico filtrado. |
| `switchTab(tab)` | Alterna entre as abas Live / Report / Compare. |

### Ingestão de Dados (Comum a WS e USB)
| Função | Descrição |
|--------|-----------|
| `processDataPacket(ts, ax, ay, az, fx, fy, fz)` | **Hub central** – alimenta buffers circulares, atualiza métricas ao vivo, dispara redesenho dos gráficos (limitado) e anexa ao `recordBuffer` se estiver gravando. |

### Conectividade
| Função | Descrição |
|--------|-----------|
| `connectWS()` | Abre WebSocket binário; decodifica pacotes de 28 bytes e chama `processDataPacket`. |
| `connectUSB()` / `disconnectUSB()` | Gerencia a conexão Web Serial; `readLoopUSB` remonta pacotes fragmentados. |
| `readLoopUSB(reader)` | Loop assíncrono lendo bytes, reconstruindo quadros e invocando `processDataPacket`. |

### Gravação e Armazenamento
| Função | Descrição |
|--------|-----------|
| `startRecording()` / `stopRecording()` | Controlam o buffer de gravação; ao parar, salvam os dados brutos no IndexedDB e disparam a análise offline (`processSessionData`). |
| `saveRawData(sessionId, buffer)` / `getRawData()` | Operações do IndexedDB para persistência dos dados brutos. |
| `countRawSessions()` / `updateRawCountBadge()` | Contam e exibem o número de sessões com dados brutos. |

### DSP Central (Computação pura, sem DOM)
| Função | Descrição |
|--------|-----------|
| `meanOf(arr)` | Média aritmética. |
| `detrendMean(arr)` | Remove a média (tendência de ordem zero). |
| `integrateBandPower(freqs, psd, low, high)` | Integração trapezoidal com interpolação linear nas bordas. |
| `weightedCentroid(freqs, psd, low, high)` | Centroide espectral (centro de massa) dentro de uma banda. |
| `fftRadix2(real, imag)` | FFT radix‑2 in‑place (requer N potência de dois). |
| `computeWelchPSD3D(filtX, filtY, filtZ, fs)` | **Função principal de PSD** – método de Welch com janela Hann, segmentos de 512 amostras, 50% de sobreposição, NFFT 1024. Retorna frequências, PSD bruta/normalizada, potência total, potência da banda (2–9 Hz), frequência dominante, centroide, razão harmônica. |
| `renderSpectrogram(filtX, filtY, filtZ, fs)` | Calcula FFTs em janelas deslizantes e desenha o espectrograma no canvas (mistura computação e renderização). |
| `processSessionData(sessionId)` | **Orquestrador** – lê dados brutos, calcula todas as métricas, atualiza cartões da UI, desenha PSD e espectrograma, constrói o registro da sessão e persiste no `localStorage`. |

### Gerenciamento de Sessões e Comparação
| Função | Descrição |
|--------|-----------|
| `renderSessionTable()` | Renderiza a lista de sessões salvas com caixas de seleção. |
| `clearDatabase()` | Exclui todos os metadados e dados brutos (com confirmação). |
| `selectAllSessions()` | Marca/desmarca todas as caixas. |
| `renderComparison()` | Sobrepõe PSDs das sessões selecionadas e constrói a tabela de comparação de métricas. |

### Exportações
| Função | Descrição |
|--------|-----------|
| `exportExcel()` | Gera um `.xlsx` com planilhas de resumo e PSD (usa SheetJS). |
| `exportCSV()` | Exporta dados brutos das sessões selecionadas (formato CSV). |
| `deleteSelectedRaw()` | Remove dados brutos do IndexedDB (mantém metadados). |
| `exportReportImage()` | Captura o contêiner do relatório como PNG (usa `html2canvas`). |

> **Nota:** As funções de DSP (`meanOf`, `detrendMean`, `integrateBandPower`, `weightedCentroid`, `fftRadix2`, `computeWelchPSD3D`) têm **zero dependências de DOM**.

---

## Métricas Clínicas e Interpretação

| Métrica | Descrição |
|---------|-----------|
| **Frequência Dominante (2–9 Hz)** | Pico do espectro de potência dentro da banda operacional. |
| **Potência Relativa (2–9 Hz)** | Porcentagem da potência total (1,5–15 Hz) na banda de 2–9 Hz. |
| **RMS da Banda (2–9 Hz)** | Raiz quadrada da potência integrada da banda – medida de amplitude. |
| **RMS do Sinal Filtrado (1,5–15 Hz)** | RMS total do sinal filtrado triaxial. |
| **Centroide Espectral (2–9 Hz)** | “Centro de massa” da distribuição espectral. |
| **Razão Harmônica** | Razão entre a potência fundamental e a soma das potências do 2º e 3º harmônicos. |
| **Variabilidade de Amplitude (%)** | Coeficiente de variação do envelope (regularidade da amplitude). |
| **Atividade de Cruzamento de Limiar (%)** | Porcentagem do tempo em que o envelope excede 2×MAD (medida de persistência). |

---

## Personalizando o Filtro

Os coeficientes do filtro passa‑faixa são definidos em `Config.h` como uma cascata de SOS.  
Eles foram gerados com:
```python
scipy.signal.butter(4, [1.5, 15], btype='band', fs=128, output='sos')
```

Para alterar a banda passante ou a taxa de amostragem:
1. Recalcule os coeficientes com Python/SciPy.
2. Substitua `BANDPASS_SOS` em `Config.h`.
3. Atualize `SAMPLE_RATE_HZ` e recompile.
4. **No frontend**, ajuste `ANALYSIS_CONFIG.expectedFsHz` e as bandas de análise (`signalBand`, `tremorBand`) de acordo.

---

## Capturas de Tela

| Painel ao Vivo | PSD e Espectrograma | Visualização de Comparação |
|:---:|:---:|:---:|
| <img width="1920" height="931" alt="image" src="https://github.com/user-attachments/assets/e7d77a22-3b84-4015-8580-9d85eba98c1e" /> | <img width="1897" height="1600" alt="image" src="https://github.com/user-attachments/assets/7f6dbf41-e339-4427-aa75-011aabbd2e4d" />| <img width="1903" height="1356" alt="image" src="https://github.com/user-attachments/assets/7f061c8f-ab5e-44bc-abcb-dca3705ece02" />

---

## Solução de Problemas

| Sintoma | Causa Provável | Solução |
|---------|----------------|----------|
| TFT permanece apagado | Mapeamento de pinos incorreto | Verifique `PIN_TFT_*` em `Config.h`. |
| IMU não detectado | Endereço I²C ou fiação errados | Confirme `QMI8658_I2C_ADDR` (0x6B). Verifique os pinos SDA/SCL. |
| Falha no WebSocket | Firewall ou IP incorreto | Certifique-se de estar na mesma rede; tente o modo AP. |
| Sem forma de onda no painel | Dados não estão fluindo | Verifique o debug serial do ESP; confirme se o WebSocket binário ou Serial está funcionando. |
| Espectrograma não aparece | Gravação muito curta | Grave pelo menos 5 segundos para resolução adequada. |
| Falha na exportação Excel/CSV | Dados brutos ausentes | Sessões antigas podem não ter dados brutos; use a exportação processada. |
| Falha na conexão USB | Navegador sem Web Serial API | Use Chrome/Edge; instale o driver serial. |

---

## Créditos

Design de hardware baseado na placa Waveshare ESP32‑S3‑Touch‑LCD‑1.69.  
Conceitos de processamento de sinais extraídos da literatura consolidada de análise de tremor.

---

**Contato:** [Matheus Aronque / aronque@hotmail.com]

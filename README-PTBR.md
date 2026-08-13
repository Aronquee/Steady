# Steady – Ferramenta Clínica para Avaliação de Tremor

**Steady** é um sistema portátil para avaliação quantitativa do tremor. Combina um sensor vestível baseado em ESP32‑S3 com uma interface web autossuficiente, permitindo que médicos capturem, visualizem e analisem o tremor durante manobras padronizadas (repouso, postural, cinético, intencional).

O dispositivo transmite dados de acelerômetro brutos e filtrados (passa‑banda) em tempo real via Wi‑Fi (WebSocket) ou **USB (Serial)**. O painel HTML incluído fornece gráficos ao vivo, controle de gravação, relatório offline com métricas espectrais e interpretação quantitativa, além de um **banco de dados local** com suporte a **comparação de sessões** e **exportação avançada de dados** para pesquisa futura – tudo sem a necessidade de instalar qualquer software além de um navegador moderno.

---

## Visão Geral do Sistema

```
┌────────────────────────────────────────────────────────────────┐
│                 ESP32‑S3 (Sensor Vestível)                   │
│  • Acelerômetro QMI8658 @ 128 Hz                            │
│  • Filtro passa‑banda fixo 1,5–15 Hz (Butterworth ordem 4) │
│  • Display TFT: formas de onda rolantes + barra de amplitude│
│  • Servidor WebSocket (modos AP + STA)                     │
│  • Transmissão binária via Wi‑Fi e **USB‑Serial**          │
│  • Pacote: 28 bytes (timestamp + 3 brutos + 3 filtrados)   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Wi‑Fi / WebSocket ou USB‑Serial
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│            Navegador Web (Frontend + Análise)                  │
│  • Conexão WebSocket ou Web Serial (USB)                     │
│  • Gráficos ao vivo (brutos e filtrados)                     │
│  • Controle de gravação, seleção de tarefa e UPDRS           │
│  • Armazenamento de dados brutos no **IndexedDB**            │
│  • PSD via Welch (segmentos 512, overlap 50%, NFFT 1024)     │
│  • Espectrograma tempo‑frequência                            │
│  • Métricas quantitativas (RMS, potência relativa,           │
│    centroide espectral, razão harmônica, variabilidade,      │
│    atividade acima do limiar)                                │
│  • Relatório interpretativo com badges de análise            │
│  • Banco de dados de sessões e **comparação** entre elas     │
│  • Exportação: PNG (relatório), Excel (resumo + PSD),        │
│    CSV (dados brutos)                                        │
└─────────────────────────────────────────────────────────────────┘
```

O ESP32 atua como **front‑end de medição transparente** – não realiza classificação ou detecção de episódios. Toda a interpretação diagnóstica ocorre no navegador, utilizando técnicas consolidadas de processamento de sinais.

---

## Requisitos de Hardware

- **Placa:** Waveshare ESP32‑S3‑Touch‑LCD‑1.69 (display ST7789V2, touch CST816T, PMU AXP2101)
- **IMU:** QMI8658 onboard (endereço I²C `0x6B`)
- **Alimentação:** USB‑C ou bateria Li‑ion (gerenciada pelo AXP2101)
- **Pinagem:** definida em `Config.h` – verifique com a revisão da sua placa antes de conectar.

---

## Conteúdo do Repositório

| Arquivo / Pasta | Descrição |
|-----------------|-----------|
| `steady_firmware.ino` | Sketch principal do Arduino (dual‑core FreeRTOS) |
| `Config.h` | Mapeamento de pinos, coeficientes do filtro, credenciais Wi‑Fi |
| `TremorSensor.h` / `QMI8658Sensor.cpp` | Abstração do IMU e driver |
| `DSPPipeline.h/.cpp` | Cascata de biquad (Butterworth passa‑banda 1,5–15 Hz) + envelope |
| `DisplayManager.h/.cpp` | Renderização de formas de onda no TFT |
| `NetworkManager.h/.cpp` | Servidor WebSocket, transmissão binária, manipulação de comandos |
| **`index.html`** | **Painel clínico – estrutura e design** (interface do usuário) |
| **`script.js`** | **Lógica completa do painel** – conexão WebSocket/USB, processamento de sinais, métricas, interpretação, banco de dados local e exportações |
| `README.md` | Este documento |

---

## Configuração do Firmware

### 1. Configure `Config.h`

- **Wi‑Fi:** Defina `WIFI_STA_SSID` e `WIFI_STA_PASSWORD` para sua rede. Se o modo STA falhar, o dispositivo entra em modo AP com SSID `Steady-Device` (senha `steadyadmin`).
- **Coeficientes do filtro:** Os coeficientes SOS pré‑calculados foram validados com `scipy.signal.butter` para uma banda de **1,5–15 Hz**, ordem 4, taxa de 128 Hz – **não os altere** a menos que tenha recalibrado o filtro.
- **Taxa de amostragem:** `SAMPLE_RATE_HZ = 128` (fixa; alterá‑la exige o recálculo do filtro e ajuste dos parâmetros de análise no frontend).

### 2. Instale as Bibliotecas Arduino Necessárias

- `Arduino_GFX` (para o display)
- `SensorQMI8658` (driver do IMU)
- `WiFi` / `ESPmDNS` / `ESPAsyncWebServer` (nativas do núcleo ESP32)

### 3. Compile e Carregue

Abra `steady_firmware.ino` na Arduino IDE (ou PlatformIO). Selecione a placa **ESP32S3 Dev Module** com as configurações USB/seriais apropriadas. Grave o firmware.

Após a inicialização, o dispositivo imprime seu endereço IP (ou SSID do AP) no monitor serial (`115200 baud`). O TFT mostrará uma mensagem de inicialização e, em seguida, começará a exibir as formas de onda filtradas em tempo real assim que os dados chegarem.

---

## Utilizando o Painel Clínico

### 1. Conecte‑se ao Dispositivo

- **Modo STA Wi‑Fi:** Seu computador deve estar na mesma rede que o ESP32. Abra um navegador e acesse `http://steady.local` (mDNS) ou o endereço IP mostrado no monitor serial.
- **Modo AP Wi‑Fi:** Conecte seu computador à rede `Steady-Device` (senha `steadyadmin`). Em seguida, acesse `http://192.168.4.1` (ou o IP do AP impresso no serial).

### 2. Abra o `index.html`

Basta abrir o arquivo `index.html` em qualquer navegador moderno (Chrome, Edge, Firefox). Nenhum servidor web é necessário – o arquivo funciona localmente.

> **Separação de responsabilidades:**  
> - `index.html` contém toda a estrutura HTML e os estilos CSS (design).  
> - `script.js` concentra toda a lógica de conexão (WebSocket e USB), processamento de sinais, atualização de gráficos, cálculos de métricas, interpretação quantitativa, banco de dados local e exportações.

### 3. Conecte‑se ao Sensor

- **Wi‑Fi:** Digite o endereço IP do ESP32 no campo (padrão `192.168.0.140`) e clique em **Conectar WS**. O ponto de status fica verde e o botão **Iniciar Gravação** se torna ativo.
- **USB:** Clique em **Conectar USB** – o navegador solicitará a seleção da porta serial do ESP32. Após conectar, o status USB fica verde e a gravação também fica disponível (independente do Wi‑Fi). Todos os dados recebidos pela porta serial são processados da mesma forma que os via WebSocket.

### 4. Defina Paciente, UPDRS e Tarefa

- Preencha o ID do paciente e o escore UPDRS (item IV, opcional).
- Escolha a tarefa (**Tremor de Repouso**, **Postural**, **Cinético**, **Ação Intencional**) e o lado afetado.
- Esses campos são salvos junto com cada sessão de gravação.

### 5. Gravando uma Sessão

- Clique em **Iniciar Gravação** – o dispositivo começa a transmitir frames e o TFT mostra um indicador “REC”.
- Realize a manobra clínica escolhida (ex.: braços apoiados no colo, braços estendidos, dedo‑nariz).
- Clique em **Parar Gravação** – o navegador armazena os **dados brutos** no IndexedDB (para futura pesquisa) e processa todo o buffer offline.
- O painel muda automaticamente para a aba **Análise**, exibindo:
  - Frequência dominante (na banda operacional 2–9 Hz)
  - Potência relativa 2–9 Hz e RMS da banda
  - Centroide espectral e razão harmônica
  - Variabilidade de amplitude e atividade acima do limiar
  - Gráfico de Densidade Espectral de Potência (Welch)
  - Espectrograma (tempo‑frequência)
  - Interpretação quantitativa do sinal (sem classificação diagnóstica automática)

### 6. Exportando Dados

- **PNG:** Clique no botão **Exportar PNG** para salvar o relatório completo como imagem.
- **Banco de dados de sessões:** Todas as sessões concluídas são armazenadas no `localStorage` do navegador (metadados) e no IndexedDB (dados brutos). A aba **Banco de Dados e Comparação** permite:
  - Selecionar múltiplas sessões para sobreposição de curvas de PSD
  - Exibir uma matriz comparativa de métricas lado a lado
  - **Exportar dados processados (.xlsx):** inclui uma planilha de resumo com todas as métricas e uma segunda planilha com as PSDs (para análise estatística)
  - **Exportar dados brutos (.csv):** todos os eixos (ax, ay, az, fx, fy, fz) das sessões selecionadas, para validação externa
  - **Excluir dados brutos** das sessões selecionadas (economiza espaço no IndexedDB, mantendo os metadados para comparação)

---

## Métricas Clínicas e Interpretação

| Métrica | Descrição |
|---------|-----------|
| **Frequência Dominante (2–9 Hz)** | Pico do espectro de potência dentro da banda operacional, obtido via Welch. |
| **Potência Relativa (2–9 Hz)** | Percentual da potência total (1,5–15 Hz) concentrada na banda 2–9 Hz. |
| **RMS da Banda 2–9 Hz (g)** | Raiz quadrada da potência integrada na banda 2–9 Hz – medida de amplitude do tremor. |
| **RMS do Sinal Filtrado (1,5–15 Hz)** | Raiz quadrada da potência total do sinal filtrado recebido (triaxial). |
| **Centroide Espectral (2–9 Hz)** | “Centro de massa” da distribuição espectral na banda 2–9 Hz. |
| **Razão Harmônica** | Relação entre a potência da frequência fundamental e a soma das potências da segunda e terceira harmônicas. |
| **Variabilidade de Amplitude (%)** | Coeficiente de variação do envelope do sinal filtrado – descreve a regularidade da amplitude. |
| **Atividade acima do Limiar (%)** | Fração do tempo em que o envelope excede um limiar adaptativo (2× MAD) – medida de persistência do tremor. |

O painel gera uma **interpretação textual** combinando essas métricas, com graduação de severidade (leve / moderada / grave) de forma puramente quantitativa, **sem substituir o julgamento clínico**.

---

## Personalizando o Filtro

O filtro passa‑banda está definido em `Config.h` como uma cascata de seções de segunda ordem (SOS). Os coeficientes foram gerados usando `scipy.signal.butter(4, [1.5, 15], btype='band', fs=128, output='sos')`.

Para alterar a banda passante ou a taxa de amostragem:
1. Recalcule os coeficientes com Python / SciPy.
2. Substitua a matriz `BANDPASS_SOS` em `Config.h`.
3. Atualize `SAMPLE_RATE_HZ` e recompile.
4. **No frontend**, ajuste também `ANALYSIS_CONFIG.expectedFsHz` e as bandas de análise (`signalBand`, `tremorBand`) para manter a consistência.

> **Importante:** A análise no lado do navegador utiliza os dados brutos de aceleração (ax, ay, az) e recalcula o espectro de forma independente. As saídas filtradas do ESP (fx, fy, fz) são usadas apenas para exibição ao vivo e estimativa de RMS durante a gravação – o relatório final é baseado nos dados brutos para garantir consistência.

---

## Lógica do Código – `script.js`

O arquivo `script.js` implementa todo o processamento no lado do cliente. Seu fluxo principal é:

1. **Conexão**  
   - Estabelece um WebSocket binário com o ESP32 **ou** uma conexão Web Serial (USB).  
   - Recebe frames de 28 bytes (timestamp, ax, ay, az, fx, fy, fz).  
   - Acumula os pontos em buffers circulares para os gráficos ao vivo.

2. **Gravação**  
   - Quando o usuário inicia a gravação, todos os frames recebidos são armazenados em `recordBuffer`.  
   - Ao parar, o buffer é **armazenado no IndexedDB** (dados brutos) e processado offline.

3. **Processamento do Sinal (offline)**  
   - **Magnitude combinada** dos eixos filtrados.  
   - **Métricas de amplitude**: RMS total, MAD, ENMO, variabilidade (CV do envelope), atividade acima do limiar (baseado em MAD adaptativo).  
   - **Estimativa de deslocamento** via dupla integração com deriva removida (para análise qualitativa).  
   - **PSD (Welch)**: segmentação com janela de Hanning (512 amostras, 50% overlap), FFT radix‑2 (NFFT 1024), média dos segmentos e normalização.  
   - **Frequência dominante** e potência relativa na banda 2–9 Hz.  
   - **Centroide espectral** e **razão harmônica** (fundamental vs. 2ª e 3ª harmônicas).  
   - **Espectrograma**: janelas deslizantes, FFT por coluna, exibição com mapa de cores “inferno” e sobreposição da curva de frequência dominante.  
   - **Interpretação quantitativa** baseada em regras heurísticas (frequência, potência relativa, variabilidade, etc.), com badges de severidade.

4. **Atualização da Interface**  
   - Preenche os cartões de métricas, os gráficos PSD e o espectrograma.  
   - Exibe o texto interpretativo com badges de análise quantitativa.

5. **Banco de Dados Local**  
   - Cada sessão é salva no `localStorage` (metadados) e no **IndexedDB** (dados brutos).  
   - A aba **Comparar** permite selecionar sessões, sobrepor as PSDs, exibir uma matriz comparativa de métricas e exportar dados em lote.

6. **Exportação**  
   - Utiliza `html2canvas` para capturar o relatório e gerar um PNG.  
   - Utiliza `SheetJS` (XLSX) para exportar resumo e PSDs.  
   - Gera CSV com todos os eixos brutos das sessões selecionadas.

Todas as funções de processamento (FFT, PSD, espectrograma) são implementadas em JavaScript puro, com dependências externas mínimas (Chart.js, html2canvas, SheetJS).

---

## Solução de Problemas

| Sintoma | Causa Provável | Solução |
|---------|----------------|---------|
| TFT permanece em branco | Mapeamento de pinos incorreto | Verifique `PIN_TFT_*` em `Config.h` conforme sua placa. |
| IMU não detectado | Endereço I²C ou fiação | Confirme `QMI8658_I2C_ADDR` (0x6B). Verifique os pinos SDA/SCL. |
| Falha na conexão WebSocket | Firewall ou IP incompatível | Certifique‑se de que computador e ESP estão na mesma sub‑rede. Use o modo AP se necessário. |
| Sem forma de onda no painel | Dados não estão sendo transmitidos | Verifique se o ESP está enviando frames (debug serial). Certifique‑se de que o navegador suporta WebSocket binário ou Web Serial. |
| Espectrograma não aparece | Duração da gravação insuficiente | Grave pelo menos 5 segundos de movimento para obter resolução adequada. |
| Erro ao exportar Excel/CSV | Dados brutos ausentes no IndexedDB | Sessões antigas podem não ter brutos. Use a opção de exportar processados (Excel) para obter as PSDs. |
| Conexão USB não funciona | Navegador sem suporte à Web Serial API | Use Chrome ou Edge. Verifique se o driver serial está instalado. |

---

## Aprimoramentos Futuros (Pós‑MVP)

- Suporte ao IMU **BNO085** (já abstraído via interface `ITremorSensor`)
- **Espectrograma ao vivo** dentro do painel HTML (atualização em tempo real)
- **Sincronização em nuvem** para colaboração multi‑site
- Conectividade **BLE** como alternativa ao Wi‑Fi
- Classificação automática com modelos de machine learning (offline no navegador)

---

## Licença

Este projeto é fornecido para fins de pesquisa e avaliação clínica. **Não é um dispositivo médico certificado.** Todo o uso é por conta e risco do usuário. Os autores não assumem responsabilidade por decisões clínicas baseadas na saída deste sistema.

---

## Créditos

Desenvolvido como parte de uma iniciativa de pesquisa em engenharia biomédica. O design de hardware é baseado na placa Waveshare ESP32‑S3‑Touch‑LCD‑1.69. Os conceitos de processamento de sinais são derivados da literatura consolidada sobre análise de tremor.

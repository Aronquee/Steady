# Steady – Ferramenta Clínica para Avaliação de Tremor

**Steady** é um sistema portátil de grau clínico para avaliação quantitativa do tremor. Combina um sensor vestível baseado em ESP32‑S3 com uma interface web autossuficiente, permitindo que médicos capturem, visualizem e analisem o tremor durante manobras padronizadas (repouso, postural, cinético).

O dispositivo transmite dados de acelerômetro brutos e filtrados (passa‑banda) em tempo real via Wi‑Fi. O painel HTML incluído fornece gráficos ao vivo, controle de gravação e um relatório offline abrangente com métricas espectrais e interpretação clínica — tudo sem a necessidade de instalar qualquer software além de um navegador moderno.

---

## Visão Geral do Sistema

```
┌──────────────────────────────────────────────────────────────┐
│                 ESP32‑S3 (Sensor Vestível)                 │
│  • Acelerômetro QMI8658 @ 250 Hz                          │
│  • Filtro passa‑banda fixo 3–12 Hz (Butterworth ordem 4)  │
│  • Display TFT: formas de onda rolantes + barra de amplitude│
│  • Servidor WebSocket (modos AP + STA)                    │
│  • Transmissão binária: timestamp, eixos brutos e filtrados│
└───────────────────────────┬───────────────────────────────┘
                            │ Wi‑Fi / WebSocket (frames de 28 bytes)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│            Navegador Web (Frontend + Análise)              │
│  • Gráficos ao vivo (brutos e filtrados)                  │
│  • Controle de gravação e seleção de tarefa               │
│  • Exportação CSV dos dados brutos                        │
│  • PSD, espectrograma, frequência dominante (offline)     │
│  • Métricas clínicas: RMS, variabilidade, tremor‑ativo,   │
│    razão harmônica, potência relativa (3–8 Hz)            │
│  • Texto interpretativo (parkinsoniano / essencial /      │
│    padrão atípico, graduação de gravidade)                │
│  • Banco de dados de sessões com ferramenta de comparação │
└─────────────────────────────────────────────────────────────┘
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
| `DSPPipeline.h/.cpp` | Cascata de biquad (Butterworth passa‑banda) + envelope |
| `DisplayManager.h/.cpp` | Renderização de formas de onda no TFT |
| `NetworkManager.h/.cpp` | Servidor WebSocket, transmissão binária, manipulação de comandos |
| **`index.html`** | **Painel clínico – estrutura e design** (interface do usuário) |
| **`script.js`** | **Lógica completa do painel** – conexão WebSocket, processamento de sinais, métricas, interpretação e banco de dados local |
| `README.md` | Este documento |

Não são necessários scripts Python externos – todo o pós‑processamento é executado dentro do navegador usando JavaScript e a biblioteca Chart.js.

---

## Configuração do Firmware

### 1. Configure `Config.h`

- **Wi‑Fi:** Defina `WIFI_STA_SSID` e `WIFI_STA_PASSWORD` para sua rede. Se o modo STA falhar, o dispositivo entra em modo AP com SSID `Steady-Device`.
- **Coeficientes do filtro:** Os coeficientes SOS pré‑calculados já foram validados com `scipy.signal.butter` – não os altere a menos que tenha recalibrado o filtro.
- **Taxa de amostragem:** `SAMPLE_RATE_HZ = 250` (fixa; alterá‑la exige o recálculo do filtro).

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

Basta abrir o arquivo `index.html` em qualquer navegador moderno (Chrome, Firefox, Edge). Nenhum servidor web é necessário – o arquivo funciona localmente.

> **Separação de responsabilidades:**  
> - `index.html` contém toda a estrutura HTML e os estilos CSS (design).  
> - `script.js` concentra toda a lógica de conexão, processamento de sinais, atualização de gráficos, cálculos de métricas, interpretação clínica e gerenciamento do banco de dados local.

### 3. Conecte‑se ao Sensor

- Digite o endereço IP do ESP32 no campo (padrão `192.168.0.140`) e clique em **Conectar**.
- O ponto de status fica verde e o botão **Iniciar Gravação** se torna ativo.

### 4. Defina Paciente e Tarefa

- Preencha o ID do paciente.
- Escolha a tarefa (**Repouso**, **Postural**, **Cinético**, **Intencional**) e o lado afetado.
- Esses campos são salvos junto com cada sessão de gravação.

### 5. Gravando uma Sessão

- Clique em **Iniciar Gravação** – o dispositivo começa a transmitir frames binários e o TFT mostra um indicador “REC”.
- Realize a manobra clínica escolhida (ex.: braços apoiados no colo, braços estendidos, dedo‑nariz).
- Clique em **Parar Gravação** – o navegador processa todo o buffer offline.
- O painel muda automaticamente para a aba **Análise**, exibindo:
  - Frequência dominante e potência relativa (3–8 Hz)
  - Amplitude RMS, variabilidade e percentual de tremor‑ativo
  - Gráfico de Densidade Espectral de Potência (PSD)
  - Espectrograma (tempo‑frequência)
  - Interpretação clínica (padrão e gravidade)

### 6. Exportando Dados

- **PNG:** Clique no botão **Exportar PNG** para salvar o relatório completo como imagem.
- **Banco de dados de sessões:** Todas as sessões concluídas são armazenadas no `localStorage` do navegador. A aba **Comparar** permite selecionar múltiplas sessões e sobrepor suas curvas de PSD e métricas lado a lado.

---

## Métricas Clínicas e Interpretação

| Métrica | Descrição |
|---------|-----------|
| **Frequência Dominante** | Pico do espectro de potência (eixos combinados). 3,5–6,5 Hz sugere tremor parkinsoniano; 6,5–12 Hz sugere tremor essencial. |
| **Potência Relativa (3–8 Hz)** | Percentual da potência total dentro da faixa clássica parkinsoniana. Valores >65% reforçam a suspeita de tremor de repouso. |
| **Tremor RMS** | Raiz quadrada da média dos quadrados do sinal filtrado (3–12 Hz), média entre os eixos. |
| **Variabilidade de Amplitude** | Coeficiente de variação do envelope – valores >40% indicam tremor intermitente ou reemergente. |
| **Tremor‑ativo (%)** | Fração do tempo em que o envelope excede 0,05 g – quantifica a persistência durante a manobra. |
| **Razão Harmônica** | Razão entre a potência fundamental e a potência harmônica – >1,8 sugere oscilação sinusoidal rítmica. |
| **Centroide Espectral** | “Centro de massa” do espectro de potência – reflete o conteúdo médio de frequência. |

O painel gera uma **interpretação textual** combinando essas métricas, com graduação de gravidade (leve / moderada / grave) e sugestão do padrão clínico mais provável (parkinsoniano, tremor essencial, atípico ou baixa amplitude).

---

## Personalizando o Filtro

O filtro passa‑banda está definido em `Config.h` como uma cascata de seções de segunda ordem (SOS). Os coeficientes foram gerados usando `scipy.signal.butter(4, [3, 12], btype='band', fs=250, output='sos')`.

Para alterar a banda passante ou a taxa de amostragem:
1. Recalcule os coeficientes com Python / SciPy.
2. Substitua a matriz `BANDPASS_SOS` em `Config.h`.
3. Atualize `SAMPLE_RATE_HZ` e recompile.

> **Importante:** A análise no lado do navegador utiliza os dados brutos de aceleração (ax, ay, az) e recalcula o espectro de forma independente. As saídas filtradas do ESP (fx, fy, fz) são usadas apenas para exibição ao vivo e estimativa de RMS durante a gravação – o relatório final é baseado nos dados brutos para garantir consistência.

---

## Lógica do Código – `script.js`

O arquivo `script.js` implementa todo o processamento no lado do cliente. Seu fluxo principal é:

1. **Conexão WebSocket**  
   - Estabelece um WebSocket binário com o ESP32.  
   - Recebe frames de 28 bytes (timestamp, ax, ay, az, fx, fy, fz).  
   - Acumula os pontos em buffers circulares para os gráficos ao vivo.

2. **Gravação**  
   - Quando o usuário inicia a gravação, todos os frames recebidos são armazenados em `recordBuffer`.  
   - Ao parar, o buffer é processado offline.

3. **Processamento do Sinal (offline)**  
   - **Magnitude combinada** dos eixos filtrados.  
   - **Métricas de amplitude**: RMS, MAD, ENMO, variabilidade (CV do envelope), tremor‑ativo (threshold de 0,05 g).  
   - **Estimativa de deslocamento** via dupla integração com deriva removida.  
   - **PSD (Welch)**: segmentação com janela de Hanning, FFT radix‑2 (implementada em JS), média dos segmentos e normalização.  
   - **Frequência dominante** e potência relativa na banda 3–8 Hz.  
   - **Centroide espectral** e **razão harmônica** (fundamental vs. 2ª e 3ª harmônicas).  
   - **Espectrograma**: janelas deslizantes, FFT por coluna, exibição com mapa de cores “inferno”.  
   - **Interpretação clínica** baseada em regras heurísticas (frequência, tarefa, métricas).

4. **Atualização da Interface**  
   - Preenche os cartões de métricas, os gráficos PSD e o espectrograma.  
   - Exibe o texto interpretativo com badges de gravidade e padrão.

5. **Banco de Dados Local**  
   - Cada sessão é salva no `localStorage` como objeto JSON.  
   - A aba **Comparar** permite selecionar sessões e sobrepor as PSDs, além de exibir uma matriz comparativa de métricas.

6. **Exportação**  
   - Utiliza `html2canvas` para capturar o relatório e gerar um PNG.

Todas as funções de processamento (FFT, PSD, espectrograma) são implementadas em JavaScript puro, sem dependências externas além do Chart.js e do plugin de anotação.

---

## Solução de Problemas

| Sintoma | Causa Provável | Solução |
|---------|----------------|---------|
| TFT permanece em branco | Mapeamento de pinos incorreto | Verifique `PIN_TFT_*` em `Config.h` conforme sua placa. |
| IMU não detectado | Endereço I²C ou fiação | Confirme `QMI8658_I2C_ADDR` (0x6B). Verifique os pinos SDA/SCL. |
| Falha na conexão WebSocket | Firewall ou IP incompatível | Certifique‑se de que computador e ESP estão na mesma sub‑rede. Use o modo AP se necessário. |
| Sem forma de onda no painel | Dados não estão sendo transmitidos | Verifique se o ESP está enviando frames (debug serial). Certifique‑se de que o navegador suporta WebSocket binário. |
| Espectrograma não aparece | Duração da gravação insuficiente | Grave pelo menos 5 segundos de movimento. |

---

## Aprimoramentos Futuros (Pós‑MVP)

- Suporte ao IMU **BNO085** (já abstraído via interface `ITremorSensor`)
- **Espectrograma ao vivo** dentro do painel HTML (atualização em tempo real)
- **Sincronização em nuvem** para colaboração multi‑site
- Conectividade **BLE** como alternativa ao Wi‑Fi

---

## Licença

Este projeto é fornecido para fins de pesquisa e avaliação clínica. **Não é um dispositivo médico certificado.** Todo o uso é por conta e risco do usuário. Os autores não assumem responsabilidade por decisões clínicas baseadas na saída deste sistema.

---

## Créditos

Desenvolvido como parte de uma iniciativa de pesquisa em engenharia biomédica. O design de hardware é baseado na placa Waveshare ESP32‑S3‑Touch‑LCD‑1.69. Os conceitos de processamento de sinais são derivados da literatura consolidada sobre análise de tremor.

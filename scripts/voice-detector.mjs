/**
 * VoiceDetector - Высоконадежный детектор голосовой активности (VAD).
 * Использует ScriptProcessorNode для прямого захвата float32 сэмплов звука,
 * что гарантирует непрерывную работу в Chromium/Electron без "засыпания" узлов.
 */
export class VoiceDetector {
  constructor({
    onSpeakingChange,
    onVolumeChange,
    threshold = 8,
    boost = 2.5,
    releaseDelay = 350,
    deviceId = ""
  }) {
    this.onSpeakingChange = onSpeakingChange;
    this.onVolumeChange = onVolumeChange;
    this.threshold = threshold;
    this.boost = boost;
    this.releaseDelay = releaseDelay;
    this.deviceId = deviceId;

    this.audioContext = null;
    this.mediaStream = null;
    this.source = null;
    this.processor = null;

    this.isSpeaking = false;
    this.releaseTimer = null;
    this.isMuted = false;
    this.isRunning = false;
    this.isTesting = false;
    this.currentVolume = 0;

    this.#setupAutoResume();
  }

  #setupAutoResume() {
    const resume = async () => {
      if (this.audioContext && this.audioContext.state === "suspended") {
        try {
          await this.audioContext.resume();
          console.log("VoiceReactive | AudioContext успешно активирован (Running)");
        } catch (_) {}
      }
    };
    window.addEventListener("click", resume, { passive: true });
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume, { passive: true });
  }

  /**
   * Получить список всех доступных аудиоустройств ввода.
   */
  static async getAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === "audioinput")
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Микрофон ${idx + 1}`
        }));
    } catch (err) {
      console.warn("VoiceReactive | Ошибка при получении списка устройств:", err);
      return [];
    }
  }

  async start(preferredDeviceId = null) {
    if (preferredDeviceId !== null) {
      this.deviceId = preferredDeviceId;
    }

    this.stop();

    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn("VoiceReactive | getUserMedia не поддерживается окружением.");
      ui.notifications?.warn("VoiceReactive: Нет доступа к микрофону в данном браузере.");
      return;
    }

    try {
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true
      };

      if (this.deviceId) {
        audioConstraints.deviceId = { ideal: this.deviceId };
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();

      if (this.audioContext.state === "suspended") {
        try { await this.audioContext.resume(); } catch (_) {}
      }

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Используем ScriptProcessorNode для гарантированного захвата сырого float32 аудиопотока
      this.processor = this.audioContext.createScriptProcessor(1024, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.isRunning || this.isMuted || this.isTesting) return;

        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);

        // Гасим вывод в ноль, чтобы звук микрофона не шёл обратно в колонки/наушники
        for (let i = 0; i < output.length; i++) {
          output[i] = 0;
        }

        let sumSquares = 0;
        let peak = 0;
        const len = input.length;

        for (let i = 0; i < len; i++) {
          const val = Math.abs(input[i]);
          if (val > peak) peak = val;
          sumSquares += val * val;
        }

        const rms = Math.sqrt(sumSquares / len);
        // Гибридный замер громкости: 70% среднеквадратичное (RMS) + 30% пик
        const raw = rms * 0.7 + peak * 0.3;

        // Применяем коэффициент усиления (Boost) и переводим в 0..100%
        const volume = Math.min(100, Math.round(raw * this.boost * 100));

        this.currentVolume = volume;
        this.onVolumeChange?.(volume);

        if (volume >= this.threshold) {
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            this.onSpeakingChange?.(true);
          }
          if (this.releaseTimer) {
            clearTimeout(this.releaseTimer);
            this.releaseTimer = null;
          }
        } else if (this.isSpeaking && !this.releaseTimer) {
          this.releaseTimer = setTimeout(() => {
            this.isSpeaking = false;
            this.releaseTimer = null;
            this.onSpeakingChange?.(false);
          }, this.releaseDelay);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.isRunning = true;
      this.isMuted = false;

      const track = this.mediaStream.getAudioTracks()[0];
      console.log(`VoiceReactive | Микрофон подключен: "${track?.label || 'Default'}" (Status: ${this.audioContext.state})`);
    } catch (err) {
      console.warn("VoiceReactive | Ошибка подключения микрофона:", err);
      ui.notifications?.warn("VoiceReactive: Не удалось подключить микрофон.");
      this.isRunning = false;
    }
  }

  stop() {
    this.isRunning = false;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try { this.processor.disconnect(); } catch (_) {}
      this.processor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch (_) {}
      this.source = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      try { this.audioContext.close(); } catch (_) {}
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.isSpeaking && !this.isTesting) {
      this.isSpeaking = false;
      this.onSpeakingChange?.(false);
    }
    this.currentVolume = 0;
    this.onVolumeChange?.(0);
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      if (this.isSpeaking && !this.isTesting) {
        this.isSpeaking = false;
        if (this.releaseTimer) clearTimeout(this.releaseTimer);
        this.onSpeakingChange?.(false);
      }
      this.currentVolume = 0;
      this.onVolumeChange?.(0);
    }
    return this.isMuted;
  }

  setThreshold(val) {
    this.threshold = Number(val) || 8;
  }

  setBoost(val) {
    this.boost = Number(val) || 2.5;
  }

  setReleaseDelay(ms) {
    this.releaseDelay = Number(ms) || 350;
  }

  async setDeviceId(deviceId) {
    this.deviceId = deviceId || "";
    await this.start(this.deviceId);
  }

  /**
   * Принудительное включение подсветки для быстрой визуальной проверки (3 секунды).
   */
  testTrigger(durationMs = 3000) {
    this.isTesting = true;
    this.isSpeaking = true;
    this.onSpeakingChange?.(true);
    this.onVolumeChange?.(85);

    setTimeout(() => {
      this.isTesting = false;
      this.isSpeaking = false;
      this.onSpeakingChange?.(false);
      this.onVolumeChange?.(0);
    }, durationMs);
  }
}

import { VoiceDetector } from "./voice-detector.mjs";
import { DioramaBridge } from "./diorama-bridge.mjs";
import { TokenBridge } from "./token-bridge.mjs";
import { DockOverlay } from "./dock-overlay.mjs";

const MODULE_ID = "voice-reactive";

let detector = null;

Hooks.once("init", () => {
  // Регистрация настроек модуля
  game.settings.register(MODULE_ID, "enableDock", {
    name: "VOICE_REACTIVE.Settings.EnableDock",
    hint: "VOICE_REACTIVE.Settings.EnableDockHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => DockOverlay.render()
  });

  game.settings.register(MODULE_ID, "enableMic", {
    name: "VOICE_REACTIVE.Settings.EnableMic",
    hint: "VOICE_REACTIVE.Settings.EnableMicHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => {
      if (value) detector?.start();
      else detector?.stop();
    }
  });

  game.settings.register(MODULE_ID, "audioDeviceId", {
    name: "VOICE_REACTIVE.Settings.AudioDeviceId",
    hint: "VOICE_REACTIVE.Settings.AudioDeviceIdHint",
    scope: "client",
    config: false,
    type: String,
    default: "",
    onChange: devId => detector?.setDeviceId(devId)
  });

  game.settings.register(MODULE_ID, "micBoost", {
    name: "VOICE_REACTIVE.Settings.MicBoost",
    hint: "VOICE_REACTIVE.Settings.MicBoostHint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 1.0, max: 5.0, step: 0.5 },
    default: 2.5,
    onChange: val => detector?.setBoost(val)
  });

  game.settings.register(MODULE_ID, "micThreshold", {
    name: "VOICE_REACTIVE.Settings.MicThreshold",
    hint: "VOICE_REACTIVE.Settings.MicThresholdHint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 1, max: 40, step: 1 },
    default: 8,
    onChange: val => detector?.setThreshold(val)
  });

  game.settings.register(MODULE_ID, "releaseDelay", {
    name: "VOICE_REACTIVE.Settings.ReleaseDelay",
    hint: "VOICE_REACTIVE.Settings.ReleaseDelayHint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 100, max: 2000, step: 50 },
    default: 350,
    onChange: val => detector?.setReleaseDelay(val)
  });

  game.settings.register(MODULE_ID, "playerGlowColor", {
    name: "VOICE_REACTIVE.Settings.PlayerGlowColor",
    hint: "VOICE_REACTIVE.Settings.PlayerGlowColorHint",
    scope: "world",
    config: true,
    type: String,
    default: "#43b581",
    onChange: () => DockOverlay.refreshRoster()
  });

  game.settings.register(MODULE_ID, "gmGlowColor", {
    name: "VOICE_REACTIVE.Settings.GmGlowColor",
    hint: "VOICE_REACTIVE.Settings.GmGlowColorHint",
    scope: "world",
    config: true,
    type: String,
    default: "#f1c40f",
    onChange: () => DockOverlay.refreshRoster()
  });

  game.settings.register(MODULE_ID, "enableDiorama", {
    name: "VOICE_REACTIVE.Settings.EnableDiorama",
    hint: "VOICE_REACTIVE.Settings.EnableDioramaHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "glowIntensity", {
    name: "VOICE_REACTIVE.Settings.GlowIntensity",
    hint: "VOICE_REACTIVE.Settings.GlowIntensityHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 5, step: 1 },
    default: 3
  });

  game.settings.register(MODULE_ID, "showDioramaName", {
    name: "VOICE_REACTIVE.Settings.ShowDioramaName",
    hint: "VOICE_REACTIVE.Settings.ShowDioramaNameHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  console.info(`${MODULE_ID} | Инициализирован.`);
});

Hooks.once("ready", async () => {
  const isDioramaActive = DioramaBridge.isAvailable();
  console.info(`${MODULE_ID} | Готов. Fried Diorama подключена: ${isDioramaActive}`);

  // Обработка входящих сокетов о речи от других участников
  game.socket.on(`module.${MODULE_ID}`, data => {
    handleVoiceState(data);
  });

  // Функция централизованной подсветки (локальной и сетевой)
  function handleVoiceState({ userId, actorId, isSpeaking, isGM }) {
    const playerColor = game.settings.get(MODULE_ID, "playerGlowColor") || "#43b581";
    const gmColor = game.settings.get(MODULE_ID, "gmGlowColor") || "#f1c40f";
    const currentGlow = isGM ? gmColor : playerColor;

    // 1. Подсветка в плавающем доке
    DockOverlay.setSpeaking(userId, actorId, isSpeaking);

    // 2. Подсветка токена на карте
    TokenBridge.setSpeaking(actorId, isSpeaking, currentGlow);

    // 3. Подсветка в Fried Diorama (если включена и доступна)
    if (game.settings.get(MODULE_ID, "enableDiorama")) {
      DioramaBridge.setSpeaking(actorId, isSpeaking, currentGlow);
    }
  }

  // Инициализация детектора микрофона
  const threshold = game.settings.get(MODULE_ID, "micThreshold");
  const boost = game.settings.get(MODULE_ID, "micBoost");
  const releaseDelay = game.settings.get(MODULE_ID, "releaseDelay");
  const deviceId = game.settings.get(MODULE_ID, "audioDeviceId");

  detector = new VoiceDetector({
    threshold,
    boost,
    releaseDelay,
    deviceId,
    onVolumeChange: volume => {
      DockOverlay.updateVolume(volume, detector.isSpeaking, detector.threshold);
    },
    onSpeakingChange: isSpeaking => {
      let actorId = null;

      if (game.user.isGM) {
        // Определение активного спикера Мастера:
        // 1. Назначенный в доке НПС
        // 2. Если в Диораме открыт 1 персонаж — автоматически он!
        // 3. Выделенный токен на карте
        const dioramaActors = DioramaBridge.getOnScreenActors();

        actorId = DockOverlay.gmActiveActorId
          || (dioramaActors.length === 1 ? dioramaActors[0] : null)
          || canvas.tokens?.controlled?.[0]?.actor?.id 
          || null;
      } else {
        // Для игрока — его назначенный персонаж
        actorId = game.user.character?.id || null;
      }

      const payload = {
        userId: game.user.id,
        actorId,
        isSpeaking,
        isGM: game.user.isGM
      };

      // Локальная подсветка без задержки
      handleVoiceState(payload);

      // Трансляция остальным участникам сессии
      game.socket.emit(`module.${MODULE_ID}`, payload);
    }
  });

  // Запуск микрофона, если включен в настройках
  if (game.settings.get(MODULE_ID, "enableMic")) {
    await detector.start();
  }

  // Инициализация плавающего дока
  DockOverlay.init({
    onMuteToggle: () => detector.toggleMute(),
    onTestTrigger: () => detector.testTrigger(3000),
    getDetector: () => detector,
    onConfigSave: ({ devId, thresh, boost }) => {
      if (devId !== undefined) detector.setDeviceId(devId);
      if (thresh !== undefined) detector.setThreshold(thresh);
      if (boost !== undefined) detector.setBoost(boost);
    }
  });

  // Интерактивный выбор НПС кликом в Fried Diorama для Ведущего
  if (game.user.isGM) {
    document.addEventListener("pointerdown", e => {
      const charNode = e.target.closest(".fg-screen-character");
      if (!charNode) return;

      const tools = charNode.querySelector(".fg-character-tools");
      const actorId = tools?.dataset?.actorId;

      if (actorId) {
        DockOverlay.setGmActiveActor(actorId);
        const name = game.actors.get(actorId)?.name || "НПС";
        ui.notifications.info(`Спикер Ведущего: ${name}`);
      }
    }, true);

    // MutationObserver: авто-синхронизация при появлении новых персонажей в Диораме
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        DockOverlay.syncWithDioramaOrScene();
      }, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Очистка при смене сцены
  Hooks.on("canvasReady", () => {
    DioramaBridge.clearAll();
    TokenBridge.clearAll();
  });
});

import { DioramaBridge } from "./diorama-bridge.mjs";
import { TokenBridge } from "./token-bridge.mjs";
import { VoiceDetector } from "./voice-detector.mjs";

/**
 * DockOverlay - Плавающий перетаскиваемый док с портретами участников.
 * Независим от наличия других модулей.
 */
export class DockOverlay {
  static #element = null;
  static #gmActiveActor = { id: null, name: null, img: null };
  static #pos = { x: 120, y: 70 };
  static #isMinimized = false;
  static #onMuteToggle = null;
  static #onTestTrigger = null;
  static #onConfigSave = null;
  static #getDetector = null;
  static #calibrationDialog = null;

  static init({ onMuteToggle, onTestTrigger, onConfigSave, getDetector }) {
    this.#onMuteToggle = onMuteToggle;
    this.#onTestTrigger = onTestTrigger;
    this.#onConfigSave = onConfigSave;
    this.#getDetector = getDetector;

    this.#loadPosition();
    this.render();

    // Слушатели подключения пользователей
    Hooks.on("userConnected", () => this.refreshRoster());
    Hooks.on("userDisconnected", () => this.refreshRoster());

    // Обновление активного НПС для Ведущего при выделении токена на карте
    Hooks.on("controlToken", (token, controlled) => {
      if (!game.user.isGM) return;
      if (controlled && token?.actor) {
        this.setGmActiveActor(token.actor.id, token.actor.name, token.actor.img);
      } else if (!canvas.tokens?.controlled?.length) {
        this.syncWithDioramaOrScene();
      }
    });

    // Авто-синхронизация при смене сцены
    Hooks.on("canvasReady", () => {
      setTimeout(() => this.syncWithDioramaOrScene(), 500);
    });

    // Первичная синхронизация
    setTimeout(() => this.syncWithDioramaOrScene(), 1000);
  }

  static get gmActiveActorId() {
    return this.#gmActiveActor.id;
  }

  static setGmActiveActor(actorId, actorName = null, actorImg = null) {
    // Если происходит переключение на другого актера — сбрасываем подсветку предыдущего, чтобы не залипала
    if (this.#gmActiveActor.id && this.#gmActiveActor.id !== actorId) {
      DioramaBridge.clearAll();
      TokenBridge.clearAll();
    }

    let name = actorName;
    let img = actorImg;

    if (!name || !img) {
      const actor = game.actors.get(actorId);
      if (actor) {
        name = name || actor.name;
        img = img || actor.img;
      }
    }

    this.#gmActiveActor = {
      id: actorId,
      name: name || "НПС",
      img: img || "icons/svg/mystery-man.svg"
    };

    console.log("VoiceReactive | Активный спикер Ведущего:", this.#gmActiveActor.name, `(${this.#gmActiveActor.id})`);
    this.refreshRoster();
  }

  /**
   * Умная авто-синхронизация с Fried Diorama или картой.
   */
  static syncWithDioramaOrScene() {
    if (!game.user.isGM) return;

    // 1. Проверяем, есть ли персонажи прямо сейчас на сцене Fried Diorama
    const dioramaActors = DioramaBridge.getOnScreenActors();
    if (dioramaActors.length > 0) {
      const actor = game.actors.get(dioramaActors[0]);
      if (actor) {
        this.setGmActiveActor(actor.id, actor.name, actor.img);
        return;
      }
    }

    // 2. Если в Диораме никого, проверяем выделенный токен на карте
    const controlledToken = canvas.tokens?.controlled?.[0];
    if (controlledToken?.actor) {
      this.setGmActiveActor(controlledToken.actor.id, controlledToken.actor.name, controlledToken.actor.img);
      return;
    }

    // 3. Если ничего не выделено, сбрасываем на дефолт
    if (!this.#gmActiveActor.id) {
      this.refreshRoster();
    }
  }

  static render() {
    const isEnabled = game.settings.get("voice-reactive", "enableDock");
    if (!isEnabled) {
      this.#element?.remove();
      this.#element = null;
      return;
    }

    if (!this.#element) {
      this.#element = document.createElement("div");
      this.#element.id = "voice-reactive-dock";
      document.body.appendChild(this.#element);
      this.#makeDraggable(this.#element);
    }

    this.#applyPosition();
    this.refreshRoster();
  }

  static refreshRoster() {
    if (!this.#element) return;

    const users = game.users.filter(u => u.active);
    const playerGlow = game.settings.get("voice-reactive", "playerGlowColor") || "#43b581";
    const gmGlow = game.settings.get("voice-reactive", "gmGlowColor") || "#f1c40f";

    // Заголовок с расширенным управлением и индикатором громкости
    let html = `
      <div class="voice-reactive-header">
        <div class="voice-reactive-title">
          <i class="fa-solid fa-microphone-lines"></i>
          <span>${game.i18n.localize("VOICE_REACTIVE.Dock.Header")}</span>
        </div>
        <div class="voice-reactive-controls">
          <div class="voice-reactive-vol-meter" title="Индикатор громкости">
            <div class="voice-reactive-vol-fill"></div>
          </div>
          <button type="button" class="voice-reactive-btn voice-reactive-test-btn" title="Тест подсветки (3 сек)">
            <i class="fa-solid fa-bolt"></i>
          </button>
          <button type="button" class="voice-reactive-btn voice-reactive-settings-btn" title="Настройка микрофона">
            <i class="fa-solid fa-gear"></i>
          </button>
          <button type="button" class="voice-reactive-btn voice-reactive-mute-btn" title="${game.i18n.localize("VOICE_REACTIVE.Dock.MicActive")}">
            <i class="fa-solid fa-microphone"></i>
          </button>
          <button type="button" class="voice-reactive-btn voice-reactive-min-btn" title="Свернуть/Развернуть">
            <i class="fa-solid ${this.#isMinimized ? "fa-chevron-down" : "fa-chevron-up"}"></i>
          </button>
        </div>
      </div>
    `;

    if (!this.#isMinimized) {
      html += `<div class="voice-reactive-roster">`;

      for (const u of users) {
        if (u.isGM) {
          const avatar = this.#gmActiveActor.img || u.avatar || "icons/svg/mystery-man.svg";
          const charName = this.#gmActiveActor.name || game.i18n.localize("VOICE_REACTIVE.Dock.GmSpeaker");
          const targetActorId = this.#gmActiveActor.id || "";

          html += `
            <div class="voice-reactive-tile is-gm" data-user-id="${u.id}" data-actor-id="${targetActorId}" style="--voice-reactive-current-glow: ${gmGlow}">
              <div class="voice-reactive-avatar-wrap">
                <img class="voice-reactive-avatar" src="${avatar}" alt="${charName}">
                <div class="voice-reactive-badge"></div>
              </div>
              <div class="voice-reactive-names">
                <span class="voice-reactive-char-name" title="${charName}">${charName}</span>
                <span class="voice-reactive-user-name">${u.name} (GM)</span>
              </div>
            </div>
          `;
        } else {
          const char = u.character;
          const avatar = char?.img || u.avatar || "icons/svg/mystery-man.svg";
          const charName = char?.name || game.i18n.localize("VOICE_REACTIVE.Dock.NoCharacter");
          const actorId = char?.id || "";

          html += `
            <div class="voice-reactive-tile" data-user-id="${u.id}" data-actor-id="${actorId}" style="--voice-reactive-current-glow: ${playerGlow}">
              <div class="voice-reactive-avatar-wrap">
                <img class="voice-reactive-avatar" src="${avatar}" alt="${charName}">
                <div class="voice-reactive-badge"></div>
              </div>
              <div class="voice-reactive-names">
                <span class="voice-reactive-char-name" title="${charName}">${charName}</span>
                <span class="voice-reactive-user-name">${u.name}</span>
              </div>
            </div>
          `;
        }
      }

      html += `</div>`;
    }

    this.#element.innerHTML = html;

    // Привязка кнопок управления
    const muteBtn = this.#element.querySelector(".voice-reactive-mute-btn");
    muteBtn?.addEventListener("click", () => {
      const isMuted = this.#onMuteToggle?.();
      muteBtn.classList.toggle("is-muted", isMuted);
      muteBtn.innerHTML = `<i class="fa-solid ${isMuted ? "fa-microphone-slash" : "fa-microphone"}"></i>`;
      muteBtn.title = isMuted 
        ? game.i18n.localize("VOICE_REACTIVE.Dock.MicMuted")
        : game.i18n.localize("VOICE_REACTIVE.Dock.MicActive");
    });

    const testBtn = this.#element.querySelector(".voice-reactive-test-btn");
    testBtn?.addEventListener("click", () => {
      this.#onTestTrigger?.();
      const gmName = this.#gmActiveActor.name || "персонажа";
      ui.notifications?.info(`Voice Reactive: Тест подсветки (3 сек) для: ${gmName}`);
    });

    const settingsBtn = this.#element.querySelector(".voice-reactive-settings-btn");
    settingsBtn?.addEventListener("click", () => {
      this.openCalibrationDialog();
    });

    const minBtn = this.#element.querySelector(".voice-reactive-min-btn");
    minBtn?.addEventListener("click", () => {
      this.#isMinimized = !this.#isMinimized;
      this.refreshRoster();
    });

    // Клик по карточке Ведущего для смены спикера
    if (game.user.isGM) {
      const gmTile = this.#element.querySelector('.voice-reactive-tile.is-gm');
      gmTile?.addEventListener("click", () => this.#promptGmSpeakerSelection());
    }
  }

  /**
   * Обновить шкалу громкости в реальном времени.
   */
  static updateVolume(volume, isSpeaking, threshold = 8) {
    if (this.#element) {
      const fill = this.#element.querySelector(".voice-reactive-vol-fill");
      if (fill) {
        fill.style.width = `${Math.min(100, volume)}%`;
        fill.classList.toggle("is-active", isSpeaking);
      }
    }

    // Если открыт диалог калибровки - обновляем его шкалу тоже
    if (this.#calibrationDialog?.rendered) {
      const calFill = document.querySelector("#vr-cal-fill");
      const calVolText = document.querySelector("#vr-cal-vol-text");
      const calStatusText = document.querySelector("#vr-cal-status");
      if (calFill) calFill.style.width = `${Math.min(100, volume)}%`;
      if (calVolText) calVolText.textContent = `${volume}%`;
      if (calStatusText) {
        calStatusText.textContent = isSpeaking ? "ГОВОРИТ" : "ТИШИНА";
        calStatusText.classList.toggle("is-speaking", isSpeaking);
      }
    }
  }

  /**
   * Подсветить карточку говорящего в доке.
   */
  static setSpeaking(userId, actorId, isSpeaking) {
    if (!this.#element) return;

    let tile = null;
    if (userId) {
      tile = this.#element.querySelector(`.voice-reactive-tile[data-user-id="${userId}"]`);
    }
    if (!tile && actorId) {
      tile = this.#element.querySelector(`.voice-reactive-tile[data-actor-id="${actorId}"]`);
    }

    if (tile) {
      tile.classList.toggle("is-speaking", isSpeaking);
    }
  }

  /**
   * Окно калибровки микрофона: выбор устройства, чувствительности, усиления и живая шкала.
   */
  static async openCalibrationDialog() {
    const detector = this.#getDetector?.();
    const devices = await VoiceDetector.getAudioDevices();
    const currentDeviceId = game.settings.get("voice-reactive", "audioDeviceId") || "";
    const currentThreshold = game.settings.get("voice-reactive", "micThreshold") ?? 8;
    const currentBoost = game.settings.get("voice-reactive", "micBoost") ?? 2.5;
    const currentGmColor = game.settings.get("voice-reactive", "gmGlowColor") || "#f1c40f";
    const currentPlayerColor = game.settings.get("voice-reactive", "playerGlowColor") || "#43b581";

    let devOptions = `<option value="">-- Системный по умолчанию --</option>`;
    for (const d of devices) {
      const sel = d.deviceId === currentDeviceId ? "selected" : "";
      devOptions += `<option value="${d.deviceId}" ${sel}>${d.label}</option>`;
    }

    const content = `
      <div class="vr-calibration-dialog">
        <div class="vr-calibration-row">
          <label><i class="fa-solid fa-microphone"></i> Микрофон:</label>
          <select id="vr-device-select">
            ${devOptions}
          </select>
        </div>

        <div class="vr-calibration-row">
          <label><i class="fa-solid fa-volume-high"></i> Усиление микрофона (Boost):</label>
          <div class="vr-slider-wrap">
            <input type="range" id="vr-boost-range" min="1.0" max="5.0" step="0.5" value="${currentBoost}">
            <span class="vr-slider-val" id="vr-boost-val">x${currentBoost}</span>
          </div>
        </div>

        <div class="vr-calibration-row">
          <label><i class="fa-solid fa-bullhorn"></i> Порог чувствительности (Threshold):</label>
          <div class="vr-slider-wrap">
            <input type="range" id="vr-thresh-range" min="1" max="40" step="1" value="${currentThreshold}">
            <span class="vr-slider-val" id="vr-thresh-val">${currentThreshold}%</span>
          </div>
        </div>

        <div class="vr-calibration-row">
          <label><i class="fa-solid fa-wand-magic-sparkles"></i> Интенсивность свечения (Ореол):</label>
          <div class="vr-slider-wrap">
            <input type="range" id="vr-intensity-range" min="1" max="5" step="1" value="${game.settings.get("voice-reactive", "glowIntensity") ?? 2}">
            <span class="vr-slider-val" id="vr-intensity-val">${["Тонкое", "Мягкое", "Стандарт", "Яркое", "Макс"][Math.min(4, Math.max(0, (game.settings.get("voice-reactive", "glowIntensity") ?? 2) - 1))]}</span>
          </div>
        </div>

        <div class="vr-calibration-row">
          <label><i class="fa-solid fa-palette"></i> Цвет Ведущего (RGB палитра):</label>
          <div class="vr-color-row">
            <input type="color" class="vr-color-input" id="vr-gm-color-input" value="${currentGmColor}">
            <span class="vr-color-hex" id="vr-gm-color-hex">${currentGmColor}</span>
            <div class="vr-preset-chips" data-target="gm">
              <span class="vr-chip" data-color="#f1c40f" style="background: #f1c40f;" title="Золотой"></span>
              <span class="vr-chip" data-color="#00f2fe" style="background: #00f2fe;" title="Бирюзовый"></span>
              <span class="vr-chip" data-color="#9b59b6" style="background: #9b59b6;" title="Аметист"></span>
              <span class="vr-chip" data-color="#e74c3c" style="background: #e74c3c;" title="Рубин"></span>
              <span class="vr-chip" data-color="#ffffff" style="background: #ffffff;" title="Белый"></span>
            </div>
          </div>
        </div>

        <div class="vr-calibration-row">
          <label><i class="fa-solid fa-palette"></i> Цвет Игроков (RGB палитра):</label>
          <div class="vr-color-row">
            <input type="color" class="vr-color-input" id="vr-player-color-input" value="${currentPlayerColor}">
            <span class="vr-color-hex" id="vr-player-color-hex">${currentPlayerColor}</span>
            <div class="vr-preset-chips" data-target="player">
              <span class="vr-chip" data-color="#43b581" style="background: #43b581;" title="Зеленый Discord"></span>
              <span class="vr-chip" data-color="#3498db" style="background: #3498db;" title="Синий"></span>
              <span class="vr-chip" data-color="#e67e22" style="background: #e67e22;" title="Оранжевый"></span>
              <span class="vr-chip" data-color="#fd79a8" style="background: #fd79a8;" title="Розовый"></span>
            </div>
          </div>
        </div>

        <div class="vr-calibration-row" style="flex-direction: row; align-items: center; justify-content: space-between; margin-top: 4px;">
          <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="vr-show-name-cb" ${game.settings.get("voice-reactive", "showDioramaName") ? "checked" : ""}>
            <span>Показывать имя персонажа при речи</span>
          </label>
        </div>

        <div class="vr-live-meter-wrap">
          <div style="font-weight: 600; font-size: 11px; display: flex; justify-content: space-between;">
            <span>Живой тест звука:</span>
            <span id="vr-cal-vol-text">0%</span>
          </div>
          <div class="vr-live-bar">
            <div class="vr-threshold-marker" id="vr-thresh-marker" style="left: ${currentThreshold}%;"></div>
            <div class="vr-live-fill" id="vr-cal-fill"></div>
          </div>
          <div class="vr-live-status">
            <span>Порог срабатывания: <strong id="vr-status-thresh">${currentThreshold}%</strong></span>
            <span>Статус: <strong id="vr-cal-status">ТИШИНА</strong></span>
          </div>
        </div>
      </div>
    `;

    this.#calibrationDialog = new Dialog({
      title: "Калибровка микрофона (Voice Reactive)",
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: "Применить",
          callback: async (html) => {
            const devId = html.find("#vr-device-select").val();
            const thresh = Number(html.find("#vr-thresh-range").val());
            const boost = Number(html.find("#vr-boost-range").val());
            const intensity = Number(html.find("#vr-intensity-range").val());
            const showName = html.find("#vr-show-name-cb").is(":checked");
            const gmColor = html.find("#vr-gm-color-input").val();
            const playerColor = html.find("#vr-player-color-input").val();

            await game.settings.set("voice-reactive", "audioDeviceId", devId);
            await game.settings.set("voice-reactive", "micThreshold", thresh);
            await game.settings.set("voice-reactive", "micBoost", boost);
            await game.settings.set("voice-reactive", "glowIntensity", intensity);
            await game.settings.set("voice-reactive", "showDioramaName", showName);
            await game.settings.set("voice-reactive", "gmGlowColor", gmColor);
            await game.settings.set("voice-reactive", "playerGlowColor", playerColor);

            DockOverlay.refreshRoster();
            this.#onConfigSave?.({ devId, thresh, boost });
            ui.notifications.info("Настройки сохранены!");
          }
        },
        test: {
          icon: '<i class="fas fa-bolt"></i>',
          label: "Тест подсветки",
          callback: () => {
            this.#onTestTrigger?.();
            const gmName = this.#gmActiveActor.name || "персонажа";
            ui.notifications?.info(`Voice Reactive: Тест подсветки (3 сек) для: ${gmName}`);
            return false; // Не закрывать диалог
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Закрыть"
        }
      },
      render: (html) => {
        const threshInput = html.find("#vr-thresh-range");
        const threshVal = html.find("#vr-thresh-val");
        const threshMarker = html.find("#vr-thresh-marker");
        const statusThresh = html.find("#vr-status-thresh");

        threshInput.on("input", (e) => {
          const val = e.target.value;
          threshVal.text(`${val}%`);
          threshMarker.css("left", `${val}%`);
          statusThresh.text(`${val}%`);
          detector?.setThreshold(Number(val));
        });

        const boostInput = html.find("#vr-boost-range");
        const boostVal = html.find("#vr-boost-val");
        boostInput.on("input", (e) => {
          const val = e.target.value;
          boostVal.text(`x${val}`);
          detector?.setBoost(Number(val));
        });

        const intensityInput = html.find("#vr-intensity-range");
        const intensityVal = html.find("#vr-intensity-val");
        const intensityLabels = ["Тонкое", "Мягкое", "Стандарт", "Яркое", "Макс"];
        intensityInput.on("input", (e) => {
          const val = Number(e.target.value);
          intensityVal.text(intensityLabels[val - 1] || `${val}`);
          game.settings.set("voice-reactive", "glowIntensity", val).catch(() => {});
        });

        // Интерактивная RGB палитра цветов
        const gmColorInput = html.find("#vr-gm-color-input");
        const gmColorHex = html.find("#vr-gm-color-hex");
        gmColorInput.on("input", (e) => {
          gmColorHex.text(e.target.value);
          game.settings.set("voice-reactive", "gmGlowColor", e.target.value).catch(() => {});
          DockOverlay.refreshRoster();
        });

        const playerColorInput = html.find("#vr-player-color-input");
        const playerColorHex = html.find("#vr-player-color-hex");
        playerColorInput.on("input", (e) => {
          playerColorHex.text(e.target.value);
          game.settings.set("voice-reactive", "playerGlowColor", e.target.value).catch(() => {});
          DockOverlay.refreshRoster();
        });

        // Быстрые пресеты оттенков
        html.find(".vr-chip").on("click", (e) => {
          const chip = $(e.currentTarget);
          const color = chip.data("color");
          const target = chip.closest(".vr-preset-chips").data("target");
          if (target === "gm") {
            gmColorInput.val(color);
            gmColorHex.text(color);
            game.settings.set("voice-reactive", "gmGlowColor", color).catch(() => {});
          } else {
            playerColorInput.val(color);
            playerColorHex.text(color);
            game.settings.set("voice-reactive", "playerGlowColor", color).catch(() => {});
          }
          DockOverlay.refreshRoster();
        });

        const devSelect = html.find("#vr-device-select");
        devSelect.on("change", (e) => {
          const selected = e.target.value;
          detector?.setDeviceId(selected);
        });
      },
      close: () => {
        this.#calibrationDialog = null;
      }
    }, { width: 420, classes: ["voice-reactive-dialog-window", "dialog"] }).render(true);
  }

  static #promptGmSpeakerSelection() {
    const actors = game.actors.filter(a => a.type === "npc" || a.type === "character");
    let options = `<option value="">-- ${game.user.name} (Без НПС) --</option>`;
    for (const a of actors) {
      const selected = a.id === this.#gmActiveActor.id ? "selected" : "";
      options += `<option value="${a.id}" ${selected}>${a.name}</option>`;
    }

    new Dialog({
      title: "Выбор активного спикера Ведущего",
      content: `
        <form style="padding: 10px;">
          <div class="form-group">
            <label>Персонаж, за которого говорит Ведущий:</label>
            <select name="activeActor" style="width: 100%; margin-top: 6px;">
              ${options}
            </select>
          </div>
          <p class="notes" style="font-size: 11px; color: #888; margin-top: 8px;">
            Подсказка: вы также можете кликнуть по любому персонажу в Диораме или токену на карте!
          </p>
        </form>
      `,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "Выбрать",
          callback: (html) => {
            const actorId = html.find('[name="activeActor"]').val();
            this.setGmActiveActor(actorId);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Отмена"
        }
      },
      default: "ok"
    }).render(true);
  }

  static #makeDraggable(element) {
    let isDragging = false;
    let startX = 0, startY = 0;

    const onPointerDown = (e) => {
      if (!e.target.closest(".voice-reactive-header") || e.target.closest("button")) return;
      isDragging = true;
      startX = e.clientX - this.#pos.x;
      startY = e.clientY - this.#pos.y;
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      this.#pos.x = Math.max(10, Math.min(window.innerWidth - 80, e.clientX - startX));
      this.#pos.y = Math.max(10, Math.min(window.innerHeight - 80, e.clientY - startY));
      this.#applyPosition();
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      this.#savePosition();
    };

    element.addEventListener("pointerdown", onPointerDown);
  }

  static #applyPosition() {
    if (!this.#element) return;
    this.#element.style.left = `${this.#pos.x}px`;
    this.#element.style.top = `${this.#pos.y}px`;
  }

  static #savePosition() {
    try {
      localStorage.setItem("voice-reactive-dock-pos", JSON.stringify(this.#pos));
    } catch (_) {}
  }

  static #loadPosition() {
    try {
      const saved = localStorage.getItem("voice-reactive-dock-pos");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          this.#pos = parsed;
        }
      }
    } catch (_) {}
  }
}

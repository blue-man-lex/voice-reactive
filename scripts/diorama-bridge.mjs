/**
 * DioramaBridge - Безопасный мост к модулю Fried Diorama.
 * Подсвечивает полноростовые портреты с регулируемой интенсивностью
 * и аккуратно отображает имя персонажа без пустых рамок.
 */
export class DioramaBridge {
  static isAvailable() {
    return Boolean(game.modules.get("fried-diorama")?.active);
  }

  /**
   * Получить список всех актеров, чьи портреты прямо сейчас отображаются на сцене Диорамы.
   * @returns {string[]} массив actorId
   */
  static getOnScreenActors() {
    if (!this.isAvailable()) return [];
    try {
      const tools = document.querySelectorAll(".fg-character-tools[data-actor-id]");
      return Array.from(tools).map(t => t.dataset.actorId).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  /**
   * Подсветить или погасить полноростовой портрет персонажа на сцене Диорамы.
   * @param {string|null} actorId - ID актера
   * @param {boolean} isSpeaking - говорит или молчит
   * @param {string} glowColor - цвет свечения (#43b581 или #f1c40f)
   */
  static setSpeaking(actorId, isSpeaking, glowColor = "#43b581") {
    if (!this.isAvailable()) return;

    try {
      let characterNode = null;
      let targetActorId = actorId;

      // 1. Поиск по точному actorId
      if (targetActorId) {
        const tools = document.querySelector(`.fg-character-tools[data-actor-id="${targetActorId}"]`);
        characterNode = tools?.closest(".fg-screen-character");
      }

      // 2. Умный фоллбек: если ID не совпал, но на сцене всего ОДИН персонаж Диорамы — подсвечиваем его!
      if (!characterNode) {
        const allChars = document.querySelectorAll(".fg-screen-character");
        if (allChars.length === 1) {
          characterNode = allChars[0];
          targetActorId = characterNode.querySelector(".fg-character-tools")?.dataset?.actorId;
        }
      }

      if (!characterNode) return;

      const intensityLevel = Number(game.settings.get("voice-reactive", "glowIntensity")) || 2;
      // Множитель: 1 -> 0.25 (очень деликатный тонкий контур), 2 -> 0.5 (мягкий), 3 -> 0.8, 4 -> 1.2, 5 -> 1.8
      const multipliers = [0.25, 0.5, 0.8, 1.2, 1.8];
      const intensityMult = multipliers[Math.max(0, Math.min(4, intensityLevel - 1))];

      const showNameSetting = game.settings.get("voice-reactive", "showDioramaName") ?? true;
      const label = characterNode.querySelector(".fg-character-name");

      if (isSpeaking) {
        // Гарантированно гасим всех остальных персонажей Диорамы, предотвращая залипание при переключении
        document.querySelectorAll(".fg-screen-character.voice-reactive-speaking").forEach(el => {
          if (el !== characterNode) {
            el.classList.remove("voice-reactive-speaking");
            const otherLabel = el.querySelector(".fg-character-name");
            if (otherLabel) {
              otherLabel.classList.remove("voice-reactive-name-active");
              if (otherLabel.dataset.voiceReactiveAuto === "true") {
                otherLabel.textContent = "";
                delete otherLabel.dataset.voiceReactiveAuto;
              }
            }
          }
        });

        characterNode.style.setProperty("--voice-reactive-current-glow", glowColor);
        characterNode.style.setProperty("--voice-reactive-intensity", intensityMult);
        characterNode.classList.add("voice-reactive-speaking");

        if (showNameSetting && label) {
          // Если имя персонажа пустое (курсор не наведён), заполняем его настоящим именем актера
          if (!label.textContent.trim()) {
            const actor = targetActorId ? game.actors.get(targetActorId) : null;
            if (actor?.name) {
              label.textContent = actor.name;
              label.dataset.voiceReactiveAuto = "true";
            }
          }
          label.classList.add("voice-reactive-name-active");
        }
      } else {
        characterNode.classList.remove("voice-reactive-speaking");

        if (label) {
          label.classList.remove("voice-reactive-name-active");
          // Если имя было проставлено модулем автоматически, очищаем его при молчании
          if (label.dataset.voiceReactiveAuto === "true") {
            label.textContent = "";
            delete label.dataset.voiceReactiveAuto;
          }
        }
      }
    } catch (err) {
      console.debug("VoiceReactive | DioramaBridge error:", err);
    }
  }

  /**
   * Сбросить подсветку со всех портретов Диорамы.
   */
  static clearAll() {
    try {
      document.querySelectorAll(".fg-screen-character.voice-reactive-speaking").forEach(el => {
        el.classList.remove("voice-reactive-speaking");
      });
      document.querySelectorAll(".fg-character-name.voice-reactive-name-active").forEach(el => {
        el.classList.remove("voice-reactive-name-active");
        if (el.dataset.voiceReactiveAuto === "true") {
          el.textContent = "";
          delete el.dataset.voiceReactiveAuto;
        }
      });
    } catch (_) {}
  }
}

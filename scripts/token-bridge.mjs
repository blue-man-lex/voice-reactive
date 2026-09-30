/**
 * TokenBridge - Мост реактивной подсветки токенов на карте Foundry VTT.
 * Рисует неоновый ореол вокруг активного токена говорящего на PIXI Canvas.
 */
export class TokenBridge {
  /**
   * Установить состояние подсветки токена на карте.
   * @param {string|null} actorId - ID актера
   * @param {boolean} isSpeaking - говорит или молчит
   * @param {string} glowColor - hex-цвет свечения (#43b581 или #f1c40f)
   */
  static setSpeaking(actorId, isSpeaking, glowColor = "#f1c40f") {
    if (!canvas?.ready || !canvas.tokens) return;

    let targetTokens = [];

    // 1. Поиск токенов по actorId на текущей сцене
    if (actorId) {
      targetTokens = canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
    }

    // 2. Фоллбек для Ведущего: выделенный токен на карте
    if (targetTokens.length === 0 && game.user.isGM) {
      targetTokens = canvas.tokens.controlled || [];
    }

    // 3. Дополнительный фоллбек для теста: если ничего не выбрано, берем первый видимый токен сцены
    if (targetTokens.length === 0 && game.user.isGM && isSpeaking) {
      if (canvas.tokens.placeables.length > 0) {
        targetTokens = [canvas.tokens.placeables[0]];
      }
    }

    if (targetTokens.length === 0) return;

    const hexColor = Number("0x" + glowColor.replace("#", ""));

    if (isSpeaking) {
      // Гарантированно гасим все остальные токены сцены при переключении
      for (const t of canvas.tokens.placeables) {
        if (!targetTokens.includes(t)) {
          const oldGlow = t.getChildByName("voiceReactiveGlow");
          if (oldGlow) {
            oldGlow.visible = false;
            oldGlow.clear();
          }
        }
      }
    }

    for (const token of targetTokens) {
      try {
        let glow = token.getChildByName("voiceReactiveGlow");

        if (isSpeaking) {
          if (!glow) {
            glow = new PIXI.Graphics();
            glow.name = "voiceReactiveGlow";
            token.addChild(glow);
          }

          glow.clear();
          const w = token.w || token.width || 100;
          const h = token.h || token.height || 100;
          const radius = Math.max(w, h) / 2 + 10;
          const cx = w / 2;
          const cy = h / 2;

          // Внешний яркий неоновый круг
          glow.lineStyle(6, hexColor, 1.0);
          glow.drawCircle(cx, cy, radius);

          // Внутренний яркий блик
          glow.lineStyle(2, 0xffffff, 0.9);
          glow.drawCircle(cx, cy, radius - 2);

          // Легкая полупрозрачная аура
          glow.lineStyle(12, hexColor, 0.35);
          glow.drawCircle(cx, cy, radius + 4);

          glow.visible = true;
          glow.zIndex = 1000;
          if (token.sortChildren) token.sortChildren();
        } else if (glow) {
          glow.visible = false;
          glow.clear();
        }
      } catch (err) {
        console.debug("VoiceReactive | TokenBridge error on token:", token.id, err);
      }
    }
  }

  /**
   * Снять подсветку со всех токенов на карте.
   */
  static clearAll() {
    if (!canvas?.ready || !canvas.tokens) return;
    for (const token of canvas.tokens.placeables) {
      const glow = token.getChildByName("voiceReactiveGlow");
      if (glow) {
        glow.visible = false;
        glow.clear();
      }
    }
  }
}

// --- Módulo de Telegram ---
// Usa la HTTP API de Telegram directamente (sin dependencias extra)
import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

export function isTelegramConfigured() {
  return !!(BOT_TOKEN && CHAT_ID && CHAT_ID !== 'PENDING');
}

export async function sendTelegramMessage(text, parseMode = 'HTML') {
  if (!isTelegramConfigured()) {
    console.log('⚠️ Telegram no configurado (falta BOT_TOKEN o CHAT_ID)');
    return false;
  }

  // Telegram limita a 4096 chars por mensaje
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    try {
      // Sanitizar: remover caracteres que rompen UTF-8 en el JSON de Telegram
      const cleanChunk = chunk.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
      const payload = JSON.stringify({
        chat_id: CHAT_ID,
        text: cleanChunk,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      });
      const res = await fetch(`${API_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: payload,
      });

      const json = await res.json();
      if (!json.ok) {
        console.error('❌ Telegram error:', json.description);
        return false;
      }
    } catch (err) {
      console.error('❌ Telegram error:', err.message);
      return false;
    }
  }
  return true;
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Cortar en el último newline antes del límite
    let cutAt = remaining.lastIndexOf('\n', maxLen);
    if (cutAt <= 0) cutAt = maxLen;
    chunks.push(remaining.substring(0, cutAt));
    remaining = remaining.substring(cutAt);
  }
  return chunks;
}

// --- Formatear Top N para Telegram ---
export function formatTopForTelegram(topRecords, stats) {
  const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

  let msg = `🏆 <b>TOP ${topRecords.length} VIDEOS — TikTok Roblox</b>\n`;
  msg += `📅 ${now}\n`;

  if (stats) {
    msg += `📊 Encontrados: ${stats.totalFound} | Nuevos: ${stats.newAdded} | Duplicados: ${stats.duplicatesSkipped}\n`;
  }
  msg += `\n`;

  // Mostrar top 30 en el mensaje (para no exceder límites)
  const showCount = Math.min(topRecords.length, 30);
  for (let i = 0; i < showCount; i++) {
    const v = topRecords[i];
    const views = formatNum(v.views);
    const likes = formatNum(v.likes);
    const comments = formatNum(v.comments);
    const link = `https://www.tiktok.com/@${v.author_username}/video/${v.video_id}`;
    const desc = (v.description || '').substring(0, 40).replace(/[<>&]/g, '');

    msg += `<b>#${v.rank}</b> 👁${views} ❤️${likes} 💬${comments}\n`;
    msg += `  @${v.author_username} — ${desc}${desc.length >= 40 ? '...' : ''}\n`;
    msg += `  <a href="${link}">Ver video</a>\n\n`;
  }

  if (topRecords.length > showCount) {
    msg += `... y ${topRecords.length - showCount} más en Supabase`;
  }

  return msg;
}

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

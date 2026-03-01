// --- Bot de Telegram interactivo ---
// Polling + cron scheduler + scan on-demand

import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scannerPath = join(__dirname, 'scanner.js');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// --- Estado ---
let isScanning = false;
let lastScanTime = 0;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos entre scans manuales

// --- Telegram helpers ---
async function tgCall(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMsg(chatId, text, extra = {}) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

// --- Mensaje de /start ---
function getStartMessage() {
  return `<b>🤖 TikTok Roblox Scanner Bot</b>

<b>¿Qué hace?</b>
Escanea TikTok buscando videos de Roblox usando ${HASHTAG_COUNT} hashtags. Encuentra videos nuevos y los guarda en la base de datos.

<b>🔬 ¿Cómo funciona el algoritmo de tendencias?</b>
1️⃣ <b>Recopilación</b> — Busca videos por hashtags como #roblox, #brookhaven, #bloxfruits, etc. Pagina hasta 5 páginas por hashtag (~150 videos c/u)

2️⃣ <b>Agrupación</b> — Agrupa los videos por:
   • 🎵 <b>Sonido</b> — Videos que usan el mismo audio (sound trends)
   • #️⃣ <b>Hashtag</b> — Videos con hashtags específicos no genéricos

3️⃣ <b>Puntuación</b> — Cada tendencia se puntúa por:
   • Cantidad de videos con ese sonido/hashtag
   • Views totales + likes×5 + comments×20 + shares×50
   • Bonus si los videos son recientes (últimos 7 días)
   • Bonus si el promedio de views supera 1M

4️⃣ <b>Filtrado inteligente</b>:
   • 🗑 Elimina hashtags basura (fyp, viral, parati, etc.)
   • 🎮 Detecta juegos de Roblox (Brookhaven, Blox Fruits, MM2, Evade, etc.)
   • 🏷 Clasifica tipo de contenido (Horror, Comedia, Edits, PvP, Dance, etc.)

5️⃣ <b>Anti-repetición</b> — Guarda historial de las últimas 48h. Las tendencias con videos ya reportados bajan de score, priorizando contenido nuevo.

<b>⏰ Frecuencia</b>
Escaneo automático cada <b>4 horas</b>. También podés forzar un scan con el botón de abajo.

<b>📊 Resultado</b>
Top 15 tendencias con: descripción, juego detectado, tipo de contenido, snippet del video top, y links directos a TikTok.`;
}

let HASHTAG_COUNT = 10;
try {
  const data = JSON.parse(readFileSync(join(__dirname, 'hashtags.json'), 'utf-8'));
  HASHTAG_COUNT = data.hashtags?.length || 10;
} catch { /* fallback 10 */ }

// --- Ejecutar scanner ---
function runScanner(chatId, source = 'manual') {
  if (isScanning) {
    sendMsg(chatId, '⏳ Ya hay un escaneo en curso, esperá a que termine.');
    return;
  }

  const now = Date.now();
  if (source === 'manual' && (now - lastScanTime) < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - lastScanTime)) / 60000);
    sendMsg(chatId, `⏱ Cooldown activo. Podés escanear de nuevo en <b>${remaining} minutos</b>.`);
    return;
  }

  isScanning = true;
  lastScanTime = now;
  const startTime = Date.now();

  console.log(`🔄 Scan iniciado (${source})...`);
  sendMsg(chatId, `🔄 <b>Escaneando TikTok...</b>\nEsto tarda ~2-5 minutos. Te aviso cuando termine.`);

  const child = execFile('node', [scannerPath], {
    cwd: __dirname,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  }, async (error, stdout, stderr) => {
    isScanning = false;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    if (error) {
      console.error('❌ Scanner error:', error.message);
      if (stderr) console.error(stderr);
      await sendMsg(chatId, `❌ Scanner falló después de ${elapsed}s.\n<code>${error.message.substring(0, 200)}</code>`);
    } else {
      console.log(`✅ Scan completado en ${elapsed}s`);
      // El scanner ya envía el reporte de tendencias por sí mismo
      // Solo mandamos confirmación si no se ve el reporte
    }
  });

  child.stdout?.on('data', d => process.stdout.write(d));
  child.stderr?.on('data', d => process.stderr.write(d));
}

// --- Handle updates ---
async function handleUpdate(update) {
  // Comando de texto
  if (update.message?.text) {
    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    if (text === '/start' || text === '/help') {
      await sendMsg(chatId, getStartMessage(), {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔍 Escanear ahora', callback_data: 'scan_now' },
          ]],
        },
      });
    } else if (text === '/scan') {
      runScanner(chatId, 'manual');
    } else if (text === '/status') {
      const status = isScanning
        ? '🔄 Escaneando en este momento...'
        : '😴 Idle — esperando próximo scan automático o manual.';
      const lastScan = lastScanTime
        ? new Date(lastScanTime).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
        : 'Nunca';
      await sendMsg(chatId, `<b>Estado del bot</b>\n${status}\n\n📅 Último scan: ${lastScan}`);
    }
  }

  // Botón inline
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id || cb.from.id;

    // Acknowledge el callback (quita loading del botón)
    await tgCall('answerCallbackQuery', {
      callback_query_id: cb.id,
    });

    if (cb.data === 'scan_now') {
      runScanner(chatId, 'manual');
    }
  }
}

// --- Polling loop ---
async function startPolling() {
  console.log('🤖 Bot de Telegram iniciado');
  console.log(`   Chat ID: ${CHAT_ID}`);
  console.log(`   Cooldown entre scans: ${COOLDOWN_MS / 60000} min`);
  console.log(`   Polling activo...\n`);

  let offset = 0;

  while (true) {
    try {
      const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=30`, {
        signal: AbortSignal.timeout(35000),
      });
      const data = await res.json();

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          try {
            await handleUpdate(update);
          } catch (err) {
            console.error('Error procesando update:', err.message);
          }
          offset = update.update_id + 1;
        }
      }
    } catch (err) {
      if (err.name !== 'TimeoutError') {
        console.error('Error en polling:', err.message);
        await new Promise(r => setTimeout(r, 5000)); // esperar 5s antes de reintentar
      }
    }
  }
}

// --- Cron: scan automático cada 4 horas ---
cron.schedule('0 */4 * * *', () => {
  console.log(`\n⏰ Cron trigger: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
  runScanner(CHAT_ID, 'cron');
});

console.log('⏰ Cron programado: cada 4 horas (0 */4 * * *)');

// --- Arrancar ---
startPolling().catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});

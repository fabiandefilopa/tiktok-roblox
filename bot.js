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
  return `<b>TikTok Roblox Scanner Bot</b>

<b>Que hace?</b>
Escanea TikTok buscando videos de Roblox usando ${HASHTAG_COUNT} hashtags. Encuentra videos nuevos y los guarda en la base de datos.

<b>Como funciona el algoritmo de tendencias?</b>
1. <b>Recopilacion</b> - Busca videos por hashtags como #roblox, #brookhaven, #bloxfruits, etc. Pagina hasta 5 paginas por hashtag (~150 videos c/u)

2. <b>Agrupacion</b> - Agrupa los videos por:
   - <b>Sonido</b> - Videos que usan el mismo audio (sound trends)
   - <b>Hashtag</b> - Videos con hashtags especificos no genericos

3. <b>Puntuacion</b> - Cada tendencia se puntua por:
   - Cantidad de videos con ese sonido/hashtag
   - Views totales + likes x 5 + comments x 20 + shares x 50
   - Bonus si los videos son recientes (ultimos 7 dias)
   - Bonus si el promedio de views supera 1M

4. <b>Filtrado inteligente</b>:
   - Elimina hashtags basura (fyp, viral, parati, etc.)
   - Detecta juegos de Roblox (Brookhaven, Blox Fruits, MM2, Evade, etc.)
   - Clasifica tipo de contenido (Horror, Comedia, Edits, PvP, Dance, etc.)

5. <b>Anti-repeticion</b> - Guarda historial de las ultimas 48h. Las tendencias con videos ya reportados bajan de score, priorizando contenido nuevo.

<b>Frecuencia</b>
Escaneo automatico cada <b>4 horas</b>. Tambien podes forzar un scan con el boton de abajo.

<b>Resultado</b>
Top 15 tendencias con: descripcion, juego detectado, tipo de contenido, snippet del video top, y links directos a TikTok.`;
}

let HASHTAG_COUNT = 10;
try {
  const data = JSON.parse(readFileSync(join(__dirname, 'hashtags.json'), 'utf-8'));
  HASHTAG_COUNT = data.hashtags?.length || 10;
} catch { /* fallback 10 */ }

// --- Ejecutar scanner ---
async function runScanner(chatId, source = 'manual') {
  if (isScanning) {
    sendMsg(chatId, '⏳ Ya hay un escaneo en curso, espera a que termine.');
    return;
  }

  const now = Date.now();
  if (source === 'manual' && (now - lastScanTime) < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - lastScanTime)) / 60000);
    sendMsg(chatId, `⏱ Cooldown activo. Podes escanear de nuevo en <b>${remaining} minutos</b>.`);
    return;
  }

  isScanning = true;
  lastScanTime = now;
  const startTime = Date.now();

  console.log(`🔄 Scan iniciado (${source})...`);

  // Enviar mensaje inicial y guardar message_id para editarlo
  const initRes = await sendMsg(chatId, '🔄 <b>Escaneando TikTok...</b>\nIniciando...');
  const progressMsgId = initRes?.result?.message_id;

  // Estado de progreso
  let lastLines = [];
  let lastEditText = '';

  function getElapsed() {
    return ((Date.now() - startTime) / 1000).toFixed(0);
  }

  function buildProgressText() {
    const elapsed = getElapsed();
    const recent = lastLines.slice(-6).join('\n');
    return `🔄 <b>Escaneando TikTok...</b> (${elapsed}s)\n\n<code>${recent || 'Iniciando...'}</code>`;
  }

  // Editar mensaje de progreso cada 10 segundos
  const progressInterval = setInterval(async () => {
    if (!progressMsgId) return;
    const text = buildProgressText();
    if (text === lastEditText) return; // no editar si no cambió
    lastEditText = text;
    try {
      await tgCall('editMessageText', {
        chat_id: chatId,
        message_id: progressMsgId,
        text,
        parse_mode: 'HTML',
      });
    } catch { /* ignorar errores de edicion */ }
  }, 10000);

  const child = execFile('node', [scannerPath], {
    cwd: __dirname,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  }, async (error, stdout, stderr) => {
    isScanning = false;
    clearInterval(progressInterval);
    const elapsed = getElapsed();

    if (error) {
      console.error('❌ Scanner error:', error.message);
      if (stderr) console.error(stderr);
      const errText = `❌ <b>Scanner fallo</b> (${elapsed}s)\n<code>${error.message.substring(0, 200)}</code>`;
      if (progressMsgId) {
        await tgCall('editMessageText', { chat_id: chatId, message_id: progressMsgId, text: errText, parse_mode: 'HTML' });
      } else {
        await sendMsg(chatId, errText);
      }
    } else {
      console.log(`✅ Scan completado en ${elapsed}s`);
      const doneText = `✅ <b>Scan completado</b> (${elapsed}s)\n\n<code>${lastLines.slice(-8).join('\n')}</code>`;
      if (progressMsgId) {
        await tgCall('editMessageText', { chat_id: chatId, message_id: progressMsgId, text: doneText, parse_mode: 'HTML' });
      }
    }
  });

  child.stdout?.on('data', d => {
    process.stdout.write(d);
    const lines = d.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      // Limpiar emojis y caracteres especiales para <code> block
      const clean = line.replace(/[<>&]/g, '').trim();
      if (clean.length > 0) lastLines.push(clean);
    }
    // Mantener solo las últimas 20 líneas
    if (lastLines.length > 20) lastLines = lastLines.slice(-20);
  });
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

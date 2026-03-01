import TikAPI from 'tikapi';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { sendTelegramMessage, formatTopForTelegram, isTelegramConfigured } from './telegram.js';
import { analyzeTrends, formatTrendsForTelegram, saveTrendReport } from './trend-analyzer.js';

// --- Resolve paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Validar env vars ---
const REQUIRED_ENV = ['TIKAPI_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Falta la variable de entorno: ${key}`);
    console.error('   Copiá .env.example a .env y completá tus keys');
    process.exit(1);
  }
}

// --- Config ---
const api = TikAPI(process.env.TIKAPI_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const MAX_PAGES = parseInt(process.env.MAX_PAGES_PER_HASHTAG || '5');
const TOP_LIMIT = parseInt(process.env.TOP_LIMIT || '50');
const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY_MS || '6000'); // delay entre CADA request a TikAPI
const MAX_RETRIES = 4;
const HASHTAGS = JSON.parse(readFileSync(join(__dirname, 'hashtags.json'), 'utf-8')).hashtags;

// Set global de video IDs para deduplicar en memoria
const seenVideoIds = new Set();

// Stats del run
const stats = { totalFound: 0, newAdded: 0, duplicatesSkipped: 0 };

// --- Rate-limited API call wrapper ---
// TODA request a TikAPI pasa por acá para manejar 429 + delays
async function rateLimitedCall(fn, label = '') {
  let retries = 0;
  while (retries <= MAX_RETRIES) {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      if (err?.statusCode === 429) {
        retries++;
        if (retries > MAX_RETRIES) {
          console.log(`   ⛔ Rate limit persistente después de ${MAX_RETRIES} intentos ${label}`);
          return null;
        }
        const waitTime = Math.min(10000 * retries, 60000); // 10s, 20s, 30s, 40s max 60s
        console.log(`   ⏳ Rate limit ${label} (intento ${retries}/${MAX_RETRIES}), esperando ${waitTime / 1000}s...`);
        await sleep(waitTime);
        continue;
      }
      // Otro error: lanzar
      throw err;
    }
  }
  return null;
}

// --- Helpers para extraer datos del response de TikAPI ---
function getItemList(json) {
  return json?.itemList || json?.itemStruct?.itemList || [];
}

// --- Cargar IDs existentes de Supabase ---
async function loadExistingIds() {
  console.log('📦 Cargando video IDs existentes de Supabase...');
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('tiktok_videos')
      .select('video_id')
      .range(offset, offset + batchSize - 1);
    if (error) { console.error('Error cargando IDs:', error.message); break; }
    if (!data || data.length === 0) break;
    data.forEach(row => seenVideoIds.add(row.video_id));
    offset += batchSize;
  }
  console.log(`   → ${seenVideoIds.size} videos ya existentes en DB`);
}

// --- Escanear un hashtag ---
async function scanHashtag(hashtagName) {
  console.log(`\n🔍 Escaneando #${hashtagName}...`);
  const videos = [];
  let pagesScanned = 0;

  try {
    // Paso 1: Lookup por name → obtiene hashtagId (NO devuelve videos)
    const lookupResponse = await rateLimitedCall(
      () => api.public.hashtag({ name: hashtagName }),
      `(lookup #${hashtagName})`
    );

    if (!lookupResponse) {
      console.log(`   ⚠️ No se pudo obtener #${hashtagName} (rate limit o error)`);
      return videos;
    }

    const hashtagId = lookupResponse?.json?.challengeInfo?.challenge?.id;

    if (!hashtagId) {
      console.log(`   ⚠️ Hashtag #${hashtagName} no encontrado en TikTok`);
      return videos;
    }

    console.log(`   📌 Hashtag ID: ${hashtagId}`);

    // Paso 2: Fetch videos por id → devuelve itemList + cursor
    await sleep(REQUEST_DELAY);
    const firstResponse = await rateLimitedCall(
      () => api.public.hashtag({ id: hashtagId }),
      `(primera página de #${hashtagName})`
    );

    if (!firstResponse) {
      console.log(`   ⚠️ No se pudieron obtener videos de #${hashtagName}`);
      return videos;
    }

    // Procesar primera página
    const firstItems = getItemList(firstResponse?.json);
    for (const item of firstItems) {
      const vid = extractVideo(item, hashtagName);
      if (vid) videos.push(vid);
    }
    pagesScanned++;
    console.log(`   Página ${pagesScanned}: ${firstItems.length} videos (${videos.length} nuevos)`);

    // Paginar usando nextItems() del SDK de TikAPI
    let lastResponse = firstResponse;
    while (pagesScanned < MAX_PAGES && lastResponse) {
      await sleep(REQUEST_DELAY);

      const nextResponse = await rateLimitedCall(
        () => Promise.resolve(lastResponse.nextItems()),
        `(página ${pagesScanned + 1} de #${hashtagName})`
      );

      if (!nextResponse) break; // null = no hay más items o rate limit persistente

      lastResponse = nextResponse;
      const items = getItemList(lastResponse?.json);
      if (items.length === 0) break;

      for (const item of items) {
        const vid = extractVideo(item, hashtagName);
        if (vid) videos.push(vid);
      }
      pagesScanned++;
      console.log(`   Página ${pagesScanned}: ${items.length} videos (${videos.length} nuevos acumulados)`);
    }
  } catch (err) {
    console.error(`   ❌ Error en #${hashtagName}:`, err?.statusCode || '', err?.message || err);
  }

  console.log(`   ✅ #${hashtagName}: ${videos.length} videos nuevos encontrados`);
  return videos;
}

// --- Extraer datos del video y deduplicar en memoria ---
function extractVideo(item, hashtagName) {
  const videoId = item?.id || item?.video?.id;
  if (!videoId) return null;

  const id = String(videoId);
  stats.totalFound++;

  if (seenVideoIds.has(id)) {
    stats.duplicatesSkipped++;
    return null;
  }

  seenVideoIds.add(id);

  // Extraer todos los hashtags del video
  const allHashtags = (item.challenges || [])
    .map(c => c.title?.toLowerCase())
    .filter(Boolean);

  return {
    video_id: id,
    description: (item.desc || '').substring(0, 2000),
    create_time: item.createTime
      ? new Date(item.createTime * 1000).toISOString()
      : new Date().toISOString(),
    views: item.stats?.playCount ?? 0,
    likes: item.stats?.diggCount ?? 0,
    comments: item.stats?.commentCount ?? 0,
    shares: item.stats?.shareCount ?? 0,
    author_username: item.author?.uniqueId || 'unknown',
    author_nickname: item.author?.nickname || '',
    hashtags_found: [hashtagName],
    music_id: item.music?.id ? String(item.music.id) : null,
    music_title: (item.music?.title || '').substring(0, 500),
    music_author: (item.music?.authorName || '').substring(0, 200),
    all_hashtags: allHashtags.length > 0 ? allHashtags : [hashtagName],
    last_updated_at: new Date().toISOString(),
  };
}

// --- Guardar videos en Supabase ---
async function saveVideos(videos) {
  if (videos.length === 0) return;

  const batchSize = 50;
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);

    const { error: videoError } = await supabase
      .from('tiktok_videos')
      .upsert(batch, { onConflict: 'video_id', ignoreDuplicates: false });

    if (videoError) {
      console.error('Error guardando videos:', videoError.message);
      console.error('   Primer video del batch:', JSON.stringify(batch[0], null, 2));
      continue;
    }

    const relations = [];
    for (const v of batch) {
      for (const h of v.hashtags_found) {
        relations.push({ video_id: v.video_id, hashtag: h });
      }
    }

    if (relations.length > 0) {
      const { error: relError } = await supabase
        .from('video_hashtags')
        .upsert(relations, { onConflict: 'video_id,hashtag', ignoreDuplicates: true });
      if (relError) console.error('Error guardando relaciones:', relError.message);
    }
  }

  stats.newAdded += videos.length;
  console.log(`💾 ${videos.length} videos guardados en Supabase`);
}

// --- Generar Top N ---
async function generateTop(runId) {
  console.log(`\n🏆 Generando Top ${TOP_LIMIT}...`);

  const { data: allVideos, error } = await supabase
    .from('tiktok_videos')
    .select('video_id, description, views, likes, comments, author_username')
    .order('views', { ascending: false })
    .limit(Math.max(500, TOP_LIMIT * 10));

  if (error) {
    console.error('Error obteniendo videos para ranking:', error.message);
    return;
  }

  if (!allVideos || allVideos.length === 0) {
    console.log('   ⚠️ No hay videos en la DB para ranking');
    return;
  }

  const scored = allVideos.map(v => ({
    ...v,
    score: (v.views || 0) + (v.likes || 0) * 10 + (v.comments || 0) * 20,
  }));
  scored.sort((a, b) => b.score - a.score);
  const topN = scored.slice(0, TOP_LIMIT);

  const topRecords = topN.map((v, i) => ({
    run_id: runId,
    rank: i + 1,
    video_id: v.video_id,
    score: v.score,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    description: (v.description || '').substring(0, 500),
    author_username: v.author_username,
  }));

  const { error: topError } = await supabase
    .from('top_videos')
    .insert(topRecords);

  if (topError) {
    console.error('Error guardando top:', topError.message);
    return [];
  }

  console.log(`\n📊 TOP ${TOP_LIMIT} VIDEOS:`);
  console.log('─'.repeat(90));
  for (const v of topRecords) {
    const link = `https://www.tiktok.com/@${v.author_username}/video/${v.video_id}`;
    console.log(`  #${String(v.rank).padStart(2)} | 👁 ${formatNum(v.views).padStart(7)} | ❤️ ${formatNum(v.likes).padStart(7)} | 💬 ${formatNum(v.comments).padStart(6)} | Score: ${formatNum(v.score)}`);
    console.log(`       @${v.author_username} — ${v.description?.substring(0, 50)}...`);
    console.log(`       ${link}`);
  }

  return topRecords;
}

// --- Main ---
async function main() {
  const startTime = Date.now();
  console.log('🚀 TikTok Roblox Scanner iniciando...');
  console.log(`   Hashtags: ${HASHTAGS.length}`);
  console.log(`   Max páginas/hashtag: ${MAX_PAGES} (~${MAX_PAGES * 30} videos/hashtag)`);
  console.log(`   Delay entre requests: ${REQUEST_DELAY / 1000}s`);
  console.log(`   Top: ${TOP_LIMIT} videos`);
  console.log(`   Requests estimadas: ~${HASHTAGS.length * (MAX_PAGES + 2)}`);

  const estimatedMinutes = ((HASHTAGS.length * (MAX_PAGES + 2) * REQUEST_DELAY) / 60000).toFixed(1);
  console.log(`   Tiempo estimado: ~${estimatedMinutes} minutos\n`);

  await loadExistingIds();

  const { data: runData, error: runError } = await supabase
    .from('scan_runs')
    .insert({ hashtags_scanned: HASHTAGS })
    .select('id')
    .single();

  if (runError) {
    console.error('Error creando run:', runError.message);
    console.error('   ¿Ejecutaste setup.sql en Supabase? Revisá que las tablas existan.');
    return;
  }
  const runId = runData.id;
  console.log(`📝 Run #${runId} creado`);

  for (let i = 0; i < HASHTAGS.length; i++) {
    const hashtag = HASHTAGS[i];

    // Delay entre hashtags (excepto el primero)
    if (i > 0) {
      console.log(`\n⏱️ Esperando ${REQUEST_DELAY / 1000}s antes del siguiente hashtag...`);
      await sleep(REQUEST_DELAY);
    }

    const videos = await scanHashtag(hashtag);
    await saveVideos(videos);
  }

  await supabase
    .from('scan_runs')
    .update({
      total_videos_found: stats.totalFound,
      new_videos_added: stats.newAdded,
      duplicates_skipped: stats.duplicatesSkipped,
    })
    .eq('id', runId);

  const topRecords = await generateTop(runId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n📋 Resumen del Run:');
  console.log(`   Total encontrados: ${stats.totalFound}`);
  console.log(`   Nuevos agregados:  ${stats.newAdded}`);
  console.log(`   Duplicados skip:   ${stats.duplicatesSkipped}`);
  console.log(`   Tiempo total:      ${elapsed}s`);
  console.log('\n✅ Scanner finalizado');

  // Analizar tendencias
  console.log('\n🔬 Analizando tendencias...');
  const trends = await analyzeTrends();

  // Enviar reportes a Telegram si está configurado
  if (isTelegramConfigured()) {
    if (trends?.length > 0) {
      console.log('\n📨 Enviando tendencias a Telegram...');
      const trendMsg = formatTrendsForTelegram(trends);
      const sent = await sendTelegramMessage(trendMsg);
      console.log(sent ? '✅ Tendencias enviadas a Telegram' : '❌ Error enviando tendencias');

      // Guardar historial para no repetir en el próximo reporte
      await saveTrendReport(trends);
    }
  }
}

// --- Helpers ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

main().catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});

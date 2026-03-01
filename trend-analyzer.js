// --- Trend Analyzer v3 ---
// Detecta tendencias REALES y genera descripciones comprensibles

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { sendTelegramMessage, isTelegramConfigured } from './telegram.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const TREND_LIMIT = 15;

// ===================== FILTROS =====================

// Hashtags que NO aportan nada (genéricos, spam, variantes de fyp)
const TRASH_HASHTAGS = new Set([
  // Roblox genéricos
  'roblox', 'robloxgaming', 'robloxedit', 'robloxfyp', 'robloxgamer',
  'robloxhorror', 'robloxcontent', 'robloxgames', 'robloxmemes', 'robloxtrending',
  'robloxplayer', 'robloxian', 'robloxedits', 'robloxmeme', 'robloxer',
  'robloxcommunity', 'robloxtiktok', 'robloxvideo', 'robloxclips', 'robloxx',
  // FYP spam
  'fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'fy', 'viralvideo',
  'fypシ', 'fypシ゚viral', 'parati', 'fypage', 'fyppage', 'blowup',
  'fyppppppppppppppppppppppp', 'fypp', 'fyppp', 'fypppp', 'foryoupage❤️',
  // Genéricos sin valor
  'gaming', 'gamer', 'games', 'game', 'edit', 'meme', 'memes', 'trend',
  'funny', 'comedy', 'lol', 'fun', 'video', 'tiktok', 'content', 'clips',
  'capcut', 'xyzbca', 'xyz', 'xyzcba', 'goviral', 'blowthisup',
]);

// Función para filtrar hashtags que son solo variantes de fyp/spam
function isTrashHashtag(h) {
  const l = h.toLowerCase();
  if (TRASH_HASHTAGS.has(l)) return true;
  if (/^fyp+$/.test(l)) return true;           // fypppppp...
  if (/^f[o0]ry[o0]u/.test(l)) return true;    // foryou variantes
  if (/^roblox(fyp|edit|game|meme)/.test(l) && l.length < 20) return true;
  if (/^para(ti|você|vc)+/i.test(l)) return true;  // paratiiiii..., paravocê, etc.
  return false;
}

// Palabras vacías para análisis de descripciones
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
  'or', 'but', 'not', 'no', 'so', 'if', 'my', 'me', 'i', 'you', 'we', 'they',
  'he', 'she', 'this', 'that', 'with', 'from', 'are', 'was', 'be', 'been',
  'its', 'im', 'ive', 'dont', 'youre', 'were', 'wont', 'cant', 'didnt',
  'have', 'has', 'had', 'do', 'did', 'will', 'would', 'can', 'could',
  'just', 'like', 'got', 'get', 'when', 'what', 'how', 'who', 'why',
  'also', 'too', 'very', 'really', 'more', 'out', 'up', 'down',
  'new', 'one', 'two', 'make', 'know', 'want', 'thing', 'way',
  'de', 'la', 'el', 'en', 'que', 'los', 'las', 'un', 'una', 'por', 'con',
  'es', 'se', 'del', 'al', 'su', 'yo', 'tu', 'mi', 'te', 'lo', 'le', 'ya',
  'roblox', 'fyp', 'foryou', 'viral', 'trending', 'foryoupage', 'fy',
  'game', 'play', 'playing', 'video', 'watch', 'part', 'day',
]);

// ===================== JUEGOS ROBLOX =====================
// nombre amigable → patterns para detectar
const ROBLOX_GAMES_MAP = {
  'Brookhaven': ['brookhaven'],
  'Blox Fruits': ['blox fruits', 'bloxfruits', 'blox fruit'],
  'Adopt Me': ['adopt me', 'adoptme'],
  'Murder Mystery 2': ['murder mystery', 'mm2'],
  'Tower of Hell': ['tower of hell', 'toh'],
  'Arsenal': ['arsenal'],
  'Jailbreak': ['jailbreak'],
  'Royale High': ['royal high', 'royale high'],
  'Berry Avenue': ['berry avenue', 'berryavenue', 'berry ave'],
  'DOORS': ['doors'],
  'Piggy': ['piggy'],
  'Flee the Facility': ['flee the facility'],
  'Da Hood': ['da hood', 'dahood'],
  'The Mimic': ['the mimic'],
  'Evade': ['evade'],
  'Regretevator': ['regretevator'],
  'Dress to Impress': ['dress to impress', 'dti'],
  'Fisch': ['fisch'],
  'Type Soul': ['type soul'],
  'Blade Ball': ['blade ball', 'bladeball'],
  'BedWars': ['bedwars', 'bed wars'],
  'Rivals': ['rivals'],
  'Midnight Chasers': ['midnight chasers'],
  'Violence District': ['violence district'],
  'Paranormal Intrusion': ['paranormal intrusion'],
  'Steal a Brainrot': ['steal a brainrot'],
  'Penguin Knockout': ['penguin knockout'],
  'Fling Things': ['fling things'],
  "Barry's Prison Run": ["barry's prison", 'barrys prison'],
  'Pet Simulator': ['pet simulator', 'pet sim'],
  'Tower Defense': ['tower defense'],
  'Phantom Forces': ['phantom forces'],
};

// Categorías de contenido
const CONTENT_TYPES = {
  'Horror / Terror': ['horror', 'scary', 'terror', 'miedo', 'creepy', 'jumpscare'],
  'Comedia / Trolling': ['troll', 'trolling', 'prank', 'funny', 'fail', 'broma'],
  'Edits / Animaciones': ['animation', 'edit', 'transition', 'montage', 'amv'],
  'Speedrun / Obby': ['obby', 'speedrun', 'parkour', 'tower', 'glide'],
  'PvP / Combate': ['pvp', 'fight', 'combo', 'battle', '1v1', 'combate'],
  'Roleplay': ['roleplay', 'rp', 'acting', 'pretend'],
  'Builds / Creatividad': ['build', 'house', 'design', 'create', 'decorat'],
  'Memes / Brainrot': ['brainrot', 'sigma', 'skibidi', 'meme', 'shitpost'],
  'Dance / Trend': ['dance', 'trend', 'vitamina', 'coreografia', 'baile'],
};

// ===================== EXTRACCIÓN DE CONTEXTO =====================

function detectGame(texts) {
  const combined = texts.join(' ').toLowerCase();
  for (const [name, patterns] of Object.entries(ROBLOX_GAMES_MAP)) {
    for (const p of patterns) {
      if (combined.includes(p)) return name;
    }
  }
  return null;
}

// Palabras que indican que el video es realmente sobre Roblox
const ROBLOX_SIGNALS = [
  'roblox', 'robux', 'bloxburg', 'brookhaven', 'blox fruit', 'bloxfruits',
  'adopt me', 'adoptme', 'murder mystery', 'mm2', 'tower of hell', 'toh',
  'arsenal', 'jailbreak', 'royale high', 'berry avenue', 'doors', 'piggy',
  'da hood', 'dahood', 'the mimic', 'evade', 'regretevator', 'dress to impress',
  'dti', 'fisch', 'type soul', 'blade ball', 'bedwars', 'rivals', 'obby',
  'pet simulator', 'phantom forces', 'flee the facility', 'slender', 'bacon',
  'korblox', 'headless', 'avatar', 'r6', 'r15', 'catalog', 'gamepass',
  'penguin knockout', 'fling things', 'steal a brainrot', 'violence district',
];

// Calcula qué porcentaje de videos en un grupo son realmente sobre Roblox
function calculateRobloxRelevance(videos) {
  let robloxCount = 0;
  for (const v of videos) {
    const text = `${v.description || ''} ${(v.all_hashtags || []).join(' ')}`.toLowerCase();
    const isRoblox = ROBLOX_SIGNALS.some(signal => text.includes(signal));
    if (isRoblox) robloxCount++;
  }
  return videos.length > 0 ? robloxCount / videos.length : 0;
}

function detectContentType(texts) {
  const combined = texts.join(' ').toLowerCase();
  const matches = [];
  for (const [category, keywords] of Object.entries(CONTENT_TYPES)) {
    const count = keywords.filter(k => combined.includes(k)).length;
    if (count > 0) matches.push({ category, count });
  }
  matches.sort((a, b) => b.count - a.count);
  return matches.length > 0 ? matches[0].category : null;
}

function extractKeywords(texts) {
  const combined = texts.join(' ').toLowerCase()
    .replace(/[^a-záéíóúñ\s]/g, ' ');
  const words = combined.split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);

  return [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

function getUsefulHashtags(videos) {
  const counts = new Map();
  for (const v of videos) {
    for (const h of (v.all_hashtags || [])) {
      if (!isTrashHashtag(h) && h.length > 2 && h.length < 30) {
        counts.set(h, (counts.get(h) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([h]) => h);
}

function getBestSnippets(videos, count = 3) {
  return [...videos]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, count)
    .map(v => {
      let desc = (v.description || '')
        .replace(/#\S+/g, '')     // quitar hashtags
        .replace(/@\S+/g, '')     // quitar mentions
        .replace(/\s+/g, ' ')     // normalizar espacios
        .trim();
      return desc.substring(0, 80).trim();
    })
    .filter(s => s.length > 8);
}

// Generar resumen legible de la tendencia
function generateSummary(game, contentType, musicTitle, musicAuthor, keywords, snippets, videoCount) {
  const parts = [];

  // Qué se juega
  if (game) parts.push(`Videos de ${game}`);

  // Qué tipo de contenido
  if (contentType) {
    if (game) {
      parts[0] += ` (${contentType.toLowerCase()})`;
    } else {
      parts.push(`Contenido de ${contentType.toLowerCase()}`);
    }
  }

  // Si no hay ni juego ni tipo, usar keywords
  if (!game && !contentType && keywords.length > 0) {
    parts.push(`Sobre: ${keywords.slice(0, 3).join(', ')}`);
  }

  // Sonido (si es sound trend)
  if (musicTitle && !musicTitle.startsWith('original sound')) {
    parts.push(`Sonido: "${musicTitle}"`);
  }

  // Si no hay nada, usar snippet
  if (parts.length === 0 && snippets.length > 0) {
    parts.push(`"${snippets[0].substring(0, 60)}"`);
  }

  return parts.join(' — ') || `${videoCount} videos trending`;
}

// ===================== HISTORIAL =====================

// Cargar video IDs ya reportados en las últimas HISTORY_HOURS horas
const HISTORY_HOURS = parseInt(process.env.TREND_HISTORY_HOURS || '48');

async function loadReportedVideoIds() {
  const since = new Date(Date.now() - HISTORY_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('trend_history')
    .select('video_ids, trend_key')
    .gte('reported_at', since);

  if (error) {
    console.error('Error cargando historial:', error.message);
    return { reportedIds: new Set(), reportedKeys: new Set() };
  }

  const reportedIds = new Set();
  const reportedKeys = new Set();
  for (const row of (data || [])) {
    if (row.trend_key) reportedKeys.add(row.trend_key);
    for (const vid of (row.video_ids || [])) {
      reportedIds.add(vid);
    }
  }

  return { reportedIds, reportedKeys };
}

// Guardar tendencias reportadas en trend_history
async function saveTrendReport(trends) {
  const rows = trends.map(t => ({
    trend_type: t.type,
    trend_key: t.type === 'sound' ? t.best_video?.music_id || t.music_title : t.hashtag,
    video_ids: t.example_videos?.map(v => v.video_id) || [],
    rank: t.rank,
    summary: t.summary,
  }));

  const { error } = await supabase.from('trend_history').insert(rows);
  if (error) {
    console.error('Error guardando historial:', error.message);
  } else {
    console.log(`📋 ${rows.length} tendencias guardadas en historial`);
  }
}

// ===================== ANÁLISIS PRINCIPAL =====================

async function analyzeTrends() {
  console.log('🔬 Analizando tendencias...\n');

  // Cargar historial para no repetir
  const { reportedIds, reportedKeys } = await loadReportedVideoIds();
  console.log(`📋 Historial: ${reportedIds.size} videos ya reportados, ${reportedKeys.size} trends en últimas ${HISTORY_HOURS}h\n`);

  const { data: videos, error } = await supabase
    .from('tiktok_videos')
    .select('video_id, description, views, likes, comments, shares, author_username, music_id, music_title, music_author, all_hashtags, create_time')
    .not('music_id', 'is', null)
    .order('views', { ascending: false })
    .limit(2000);

  if (error || !videos?.length) {
    console.error('Error o sin datos:', error?.message);
    return null;
  }

  console.log(`📊 ${videos.length} videos para analizar\n`);

  // --- 1. Agrupar por sonido ---
  const soundMap = new Map();
  for (const v of videos) {
    if (!v.music_id) continue;
    if (!soundMap.has(v.music_id)) {
      soundMap.set(v.music_id, {
        music_id: v.music_id,
        music_title: v.music_title,
        music_author: v.music_author,
        videos: [],
      });
    }
    soundMap.get(v.music_id).videos.push(v);
  }

  // --- 2. Sound trends ---
  const soundTrends = [];
  for (const [musicId, group] of soundMap) {
    const vids = group.videos;
    if (vids.length < 2) continue;

    // Filtro de relevancia Roblox: al menos 50% de los videos deben ser sobre Roblox
    const robloxRelevance = calculateRobloxRelevance(vids);
    if (robloxRelevance < 0.5) continue;

    // Calcular cuántos videos son nuevos (no reportados antes)
    const newVids = vids.filter(v => !reportedIds.has(v.video_id));
    const reportedRatio = 1 - (newVids.length / vids.length); // 0 = todo nuevo, 1 = todo repetido

    const totalViews = vids.reduce((s, v) => s + (v.views || 0), 0);
    const totalLikes = vids.reduce((s, v) => s + (v.likes || 0), 0);
    const totalComments = vids.reduce((s, v) => s + (v.comments || 0), 0);
    const totalShares = vids.reduce((s, v) => s + (v.shares || 0), 0);
    const avgViews = totalViews / vids.length;

    const now = Date.now();
    const recentCount = vids.filter(v =>
      (now - new Date(v.create_time).getTime()) < 7 * 24 * 60 * 60 * 1000
    ).length;

    let trendScore =
      (vids.length * 1000000) +
      (totalViews * 0.1) +
      (totalLikes * 5) +
      (totalComments * 20) +
      (totalShares * 50) +
      ((recentCount / vids.length) * 5000000) +
      (avgViews > 1000000 ? 3000000 : 0);

    // Penalizar tendencias ya reportadas
    // Si 100% de videos ya fueron reportados → score * 0.05 (casi eliminado)
    // Si 50% ya reportados → score * 0.5
    // Si tiene videos nuevos → penalización menor
    if (reportedRatio > 0) {
      const penalty = 1 - (reportedRatio * 0.95);
      trendScore *= penalty;
    }
    // Bonus por videos completamente nuevos
    if (newVids.length > 0) {
      trendScore += newVids.length * 500000;
    }
    // Bonus por relevancia Roblox: sonidos 100% Roblox suben, los borderline bajan
    trendScore *= (0.5 + robloxRelevance * 0.5);

    const descs = vids.map(v => v.description || '');
    const game = detectGame(descs);
    const contentType = detectContentType(descs);
    const keywords = extractKeywords(descs);
    const snippets = getBestSnippets(vids);
    const hashtags = getUsefulHashtags(vids);

    const bestVideo = [...vids].sort((a, b) =>
      ((b.views || 0) + (b.likes || 0) * 10) - ((a.views || 0) + (a.likes || 0) * 10)
    )[0];

    const summary = generateSummary(
      game, contentType, group.music_title, group.music_author,
      keywords, snippets, vids.length
    );

    soundTrends.push({
      type: 'sound',
      music_id: musicId,
      music_title: group.music_title,
      music_author: group.music_author,
      video_count: vids.length,
      total_views: totalViews,
      total_likes: totalLikes,
      avg_views: Math.round(avgViews),
      trend_score: Math.round(trendScore),
      summary,
      game,
      content_type: contentType,
      hashtags,
      snippets,
      best_video: bestVideo,
      example_videos: [...vids].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 3),
    });
  }

  // --- 3. Hashtag trends (solo hashtags útiles) ---
  const hashtagMap = new Map();
  for (const v of videos) {
    for (const h of (v.all_hashtags || [])) {
      if (isTrashHashtag(h)) continue;
      const lower = h.toLowerCase();
      if (!hashtagMap.has(lower)) {
        hashtagMap.set(lower, { hashtag: lower, videos: [] });
      }
      hashtagMap.get(lower).videos.push(v);
    }
  }

  const hashtagTrends = [];
  for (const [tag, group] of hashtagMap) {
    const vids = group.videos;
    if (vids.length < 3) continue;

    const newVids = vids.filter(v => !reportedIds.has(v.video_id));
    const reportedRatio = 1 - (newVids.length / vids.length);

    const totalViews = vids.reduce((s, v) => s + (v.views || 0), 0);
    const totalLikes = vids.reduce((s, v) => s + (v.likes || 0), 0);
    const avgViews = totalViews / vids.length;

    let trendScore =
      (vids.length * 500000) +
      (totalViews * 0.05) +
      (totalLikes * 3) +
      (avgViews > 500000 ? 2000000 : 0);

    // Misma penalización por repetición
    if (reportedRatio > 0) {
      const penalty = 1 - (reportedRatio * 0.95);
      trendScore *= penalty;
    }
    if (newVids.length > 0) {
      trendScore += newVids.length * 300000;
    }

    const descs = vids.map(v => v.description || '');
    const game = detectGame(descs);
    const contentType = detectContentType(descs);
    const keywords = extractKeywords(descs);
    const snippets = getBestSnippets(vids);

    const bestVideo = [...vids].sort((a, b) =>
      ((b.views || 0) + (b.likes || 0) * 10) - ((a.views || 0) + (a.likes || 0) * 10)
    )[0];

    const summary = generateSummary(
      game, contentType, null, null, keywords, snippets, vids.length
    );

    hashtagTrends.push({
      type: 'hashtag',
      hashtag: `#${tag}`,
      video_count: vids.length,
      total_views: totalViews,
      total_likes: totalLikes,
      avg_views: Math.round(avgViews),
      trend_score: Math.round(trendScore),
      summary,
      game,
      content_type: contentType,
      snippets,
      best_video: bestVideo,
      example_videos: [...vids].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 3),
    });
  }

  // --- 4. Combinar, dedup, rankear ---
  const allTrends = [...soundTrends, ...hashtagTrends];
  allTrends.sort((a, b) => b.trend_score - a.trend_score);

  const usedBestIds = new Set();
  const finalTrends = [];
  for (const trend of allTrends) {
    if (finalTrends.length >= TREND_LIMIT) break;
    const bestId = trend.best_video?.video_id;
    if (bestId && usedBestIds.has(bestId) && trend.type === 'hashtag') continue;
    if (bestId) usedBestIds.add(bestId);
    finalTrends.push({ ...trend, rank: finalTrends.length + 1 });
  }

  return finalTrends;
}

// ===================== FORMATO TELEGRAM =====================

function formatTrendsForTelegram(trends) {
  const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const esc = s => (s || '').replace(/[<>&]/g, '');

  let msg = `<b>🔥 TOP ${trends.length} TENDENCIAS — TikTok Roblox</b>\n`;
  msg += `📅 ${now}\n`;
  msg += `${'—'.repeat(30)}\n\n`;

  for (const t of trends) {
    // --- Nombre de la tendencia ---
    if (t.type === 'sound') {
      const title = esc(t.music_title);
      const musicLink = t.music_id ? `https://www.tiktok.com/music/-${t.music_id}` : null;
      if (musicLink) {
        msg += `<b>#${t.rank} 🎵 <a href="${musicLink}">${title}</a></b>\n`;
      } else {
        msg += `<b>#${t.rank} 🎵 ${title}</b>\n`;
      }
    } else {
      msg += `<b>#${t.rank} ${t.hashtag}</b>\n`;
    }

    // --- Resumen (LA LÍNEA MÁS IMPORTANTE) ---
    if (t.summary) {
      msg += `📝 ${esc(t.summary)}\n`;
    }

    // --- Stats compactos ---
    msg += `📊 ${t.video_count} videos · ${fmtNum(t.total_views)} views · ${fmtNum(t.total_likes)} likes\n`;

    // --- Juego si lo hay ---
    if (t.game) {
      msg += `🎮 ${t.game}\n`;
    }

    // --- Tipo de contenido si no está en el summary ---
    if (t.content_type && !t.summary?.includes(t.content_type.toLowerCase())) {
      msg += `🏷 ${t.content_type}\n`;
    }

    // --- Frase del video top ---
    if (t.snippets?.length > 0) {
      const snip = esc(t.snippets[0]).substring(0, 70);
      if (snip.length > 10) {
        msg += `💬 "${snip}${snip.length >= 70 ? '...' : ''}"\n`;
      }
    }

    // --- Links ---
    if (t.best_video) {
      const bv = t.best_video;
      const link = `https://www.tiktok.com/@${bv.author_username}/video/${bv.video_id}`;
      msg += `⭐ <a href="${link}">@${bv.author_username}</a> (${fmtNum(bv.views)} views)\n`;
    }
    if (t.example_videos?.length > 1) {
      for (const ev of t.example_videos.slice(1, 3)) {
        const link = `https://www.tiktok.com/@${ev.author_username}/video/${ev.video_id}`;
        msg += `📎 <a href="${link}">@${ev.author_username}</a> (${fmtNum(ev.views)})\n`;
      }
    }

    msg += `\n`;
  }

  return msg;
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ===================== MAIN =====================

async function main() {
  const trends = await analyzeTrends();
  if (!trends?.length) {
    console.log('❌ No se detectaron tendencias.');
    return;
  }

  console.log(`\n🔥 TOP ${trends.length} TENDENCIAS`);
  console.log('═'.repeat(70));
  for (const t of trends) {
    const icon = t.type === 'sound' ? '🎵' : '#️⃣';
    const name = t.type === 'sound' ? t.music_title : t.hashtag;
    console.log(`\n${icon} #${t.rank} — ${name}`);
    console.log(`   📝 ${t.summary}`);
    console.log(`   📊 ${t.video_count} videos · ${fmtNum(t.total_views)} views · ${fmtNum(t.total_likes)} likes`);
    if (t.game) console.log(`   🎮 ${t.game}`);
    if (t.content_type) console.log(`   🏷 ${t.content_type}`);
    if (t.snippets?.[0]) console.log(`   💬 "${t.snippets[0].substring(0, 70)}"`);
    if (t.best_video) {
      console.log(`   ⭐ @${t.best_video.author_username} (${fmtNum(t.best_video.views)})`);
      console.log(`      https://www.tiktok.com/@${t.best_video.author_username}/video/${t.best_video.video_id}`);
    }
  }

  if (isTelegramConfigured()) {
    console.log('\n📨 Enviando a Telegram...');
    const msg = formatTrendsForTelegram(trends);
    const sent = await sendTelegramMessage(msg);
    console.log(sent ? '✅ Enviado' : '❌ Error');
  }

  // Guardar en historial para no repetir en próximos reportes
  await saveTrendReport(trends);
}

export { analyzeTrends, formatTrendsForTelegram, saveTrendReport };

const isMainModule = process.argv[1]?.endsWith('trend-analyzer.js');
if (isMainModule) {
  main().catch(err => {
    console.error('💥 Error:', err);
    process.exit(1);
  });
}

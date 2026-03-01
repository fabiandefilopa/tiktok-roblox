import TikAPI from 'tikapi';
import 'dotenv/config';

const api = TikAPI(process.env.TIKAPI_KEY);

function getItemList(json) {
  return json?.itemList || json?.itemStruct?.itemList || [];
}

console.log('━'.repeat(60));
console.log('  TEST SCAN — Solo #roblox, 1 página, sin guardar en DB');
console.log('━'.repeat(60));

try {
  // Paso 1: lookup por name → obtiene hashtagId
  console.log('\n🔍 Buscando #roblox (lookup)...');
  const lookupResponse = await api.public.hashtag({ name: 'roblox' });
  const hashtagId = lookupResponse?.json?.challengeInfo?.challenge?.id;
  console.log(`📌 Hashtag ID: ${hashtagId || 'no encontrado'}`);

  if (!hashtagId) {
    console.log('❌ No se encontró el hashtagId');
    process.exit(1);
  }

  // Paso 2: fetch videos por id
  console.log('📥 Obteniendo videos por ID...');
  const response = await api.public.hashtag({ id: hashtagId });
  const items = getItemList(response?.json);
  console.log(`📦 Videos en primera página: ${items.length}\n`);

  if (items.length === 0) {
    console.log('⚠️ No se encontraron videos.');
    console.log('   Response keys:', Object.keys(response?.json || {}));
    process.exit(1);
  }

  console.log('─'.repeat(60));
  for (const item of items) {
    const id = item.id || item.video?.id || '?';
    const desc = (item.desc || '').substring(0, 50);
    const views = item.stats?.playCount ?? 0;
    const likes = item.stats?.diggCount ?? 0;
    const comments = item.stats?.commentCount ?? 0;
    const author = item.author?.uniqueId || 'unknown';

    console.log(`  ID: ${id}`);
    console.log(`  @${author} — ${desc}${desc.length >= 50 ? '...' : ''}`);
    console.log(`  👁 ${views}  ❤️ ${likes}  💬 ${comments}`);
    console.log('─'.repeat(60));
  }

  console.log(`\n✅ Test exitoso — ${items.length} videos parseados correctamente`);

  // Verificar que nextItems existe
  if (typeof response.nextItems === 'function') {
    console.log('✅ nextItems() existe como método del response');
  } else {
    console.log('⚠️ nextItems() NO encontrado en el response — revisar paginación');
  }

} catch (err) {
  console.error('❌ Error:', err?.statusCode || '', err?.message || err);
  process.exit(1);
}

import TikAPI from 'tikapi';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const results = { supabase: false, tikapi: false };

// --- Test Supabase ---
async function testSupabase() {
  console.log('🔌 Testeando conexión a Supabase...');
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { count, error } = await supabase
      .from('tiktok_videos')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error(`   ❌ Supabase FAIL: ${error.message}`);
      return;
    }
    console.log(`   ✅ Supabase OK — ${count ?? 0} videos en tiktok_videos`);
    results.supabase = true;
  } catch (err) {
    console.error(`   ❌ Supabase FAIL: ${err.message}`);
  }
}

// --- Test TikAPI ---
async function testTikAPI() {
  console.log('🔌 Testeando conexión a TikAPI...');
  try {
    const api = TikAPI(process.env.TIKAPI_KEY);
    const response = await api.public.hashtag({ name: 'roblox' });

    if (response?.json) {
      const itemCount = response.json?.itemList?.length || response.json?.itemStruct?.itemList?.length || 0;
      console.log(`   ✅ TikAPI OK — Respuesta recibida (${itemCount} items)`);
      results.tikapi = true;
    } else {
      console.error('   ❌ TikAPI FAIL: Response sin JSON');
    }
  } catch (err) {
    console.error(`   ❌ TikAPI FAIL: ${err?.statusCode || ''} ${err?.message || err}`);
  }
}

// --- Run ---
console.log('━'.repeat(50));
console.log('  TEST DE CONEXIÓN — TikTok Roblox Scanner');
console.log('━'.repeat(50));

await testSupabase();
await testTikAPI();

console.log('\n━'.repeat(50));
console.log('  RESUMEN:');
console.log(`  ${results.supabase ? '✅' : '❌'} Supabase ${results.supabase ? 'OK' : 'FAIL'}`);
console.log(`  ${results.tikapi ? '✅' : '❌'} TikAPI ${results.tikapi ? 'OK' : 'FAIL'}`);
console.log('━'.repeat(50));

if (!results.supabase || !results.tikapi) process.exit(1);

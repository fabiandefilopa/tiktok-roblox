import cron from 'node-cron';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { sendTelegramMessage, isTelegramConfigured } from './telegram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scannerPath = join(__dirname, 'scanner.js');

console.log('🤖 Scheduler iniciado');
console.log(`   Telegram: ${isTelegramConfigured() ? '✅ Configurado' : '❌ No configurado'}`);
console.log('   Cron: cada 4 horas (0 */4 * * *)');
console.log('   Próximo scan: ejecutando ahora + cada 4h\n');

function runScanner() {
  const startTime = Date.now();
  const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔄 Ejecutando scan — ${now}`);
  console.log('═'.repeat(60));

  const child = execFile('node', [scannerPath], {
    cwd: __dirname,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024, // 10MB
  }, async (error, stdout, stderr) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    if (error) {
      console.error(`❌ Scanner falló después de ${elapsed}s:`, error.message);
      if (isTelegramConfigured()) {
        await sendTelegramMessage(`❌ <b>Scanner falló</b>\n📅 ${now}\n⏱ ${elapsed}s\nError: ${error.message}`);
      }
    } else {
      console.log(`✅ Scan completado en ${elapsed}s`);
    }
  });

  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
}

// Ejecutar inmediatamente al iniciar
runScanner();

// Programar cada 4 horas: minuto 0, cada 4 horas
cron.schedule('0 */4 * * *', () => {
  runScanner();
});

// Mantener vivo
process.on('SIGINT', () => {
  console.log('\n🛑 Scheduler detenido');
  process.exit(0);
});

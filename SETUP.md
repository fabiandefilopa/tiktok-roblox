# Setup — TikTok Roblox Scanner

## 1. Requisitos previos
- Node.js 18+ instalado (`node -v` para verificar)
- Cuenta en [tikapi.io](https://tikapi.io) con API key
- Proyecto en [Supabase](https://supabase.com) creado

## 2. Abrir en VS Code
```bash
# Cloná o descomprimí la carpeta
cd tiktok-scanner
code .
```

## 3. Instalar dependencias
Abrí la terminal de VS Code (`Ctrl+Ñ` o `` Ctrl+` ``) y ejecutá:
```bash
npm install
```

## 4. Configurar variables de entorno
```bash
# Copiá el template
cp .env.example .env
```
Editá `.env` con tus datos:
```
TIKAPI_KEY=tu_key_de_tikapi
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbG...tu_anon_key
MAX_PAGES_PER_HASHTAG=3
TOP_LIMIT=50
REQUEST_DELAY_MS=6000
```

> **Dónde encontrar cada key:**
> - **TIKAPI_KEY** → [tikapi.io/developer](https://tikapi.io/developer) → tu API Key
> - **SUPABASE_URL** → Supabase Dashboard → Settings → API → Project URL
> - **SUPABASE_KEY** → Supabase Dashboard → Settings → API → `anon` `public` key

## 5. Crear tablas en Supabase
1. Andá a tu proyecto en [app.supabase.com](https://app.supabase.com)
2. Abrí **SQL Editor** (ícono en el sidebar izquierdo)
3. Pegá TODO el contenido de `setup.sql`
4. Clickeá **Run**
5. Verificá que se crearon 4 tablas: `tiktok_videos`, `video_hashtags`, `scan_runs`, `top_videos`

## 6. Editar hashtags (opcional)
Abrí `hashtags.json` y editá la lista:
```json
{
  "hashtags": [
    "roblox",
    "robloxgaming",
    "robloxhorror"
  ]
}
```

## 7. Primer test (modo conservador)
Poné `MAX_PAGES_PER_HASHTAG=1` en `.env` y dejá solo 2-3 hashtags en `hashtags.json` para no quemar rate limit:
```json
{
  "hashtags": ["roblox", "robloxgaming"]
}
```
Luego:
```bash
npm run scan
```

> **⚠️ Si te tira 429 en todo:** subí `REQUEST_DELAY_MS=10000` o `15000` en `.env`.
> El trial de TikAPI tiene rate limits bajos (~5-10 req/min).

Si ves output como este, está funcionando:
```
🚀 TikTok Roblox Scanner iniciando...
📦 Cargando video IDs existentes de Supabase...
   → 0 videos ya existentes en DB
📝 Run #1 creado

🔍 Escaneando #roblox...
   📌 Hashtag ID: 12345678
   Página 1: 30 videos (28 nuevos)
   ✅ #roblox: 28 videos nuevos encontrados
💾 28 videos guardados en Supabase
```

## 8. Run completo
Subí `MAX_PAGES_PER_HASHTAG=10` y ejecutá:
```bash
npm run scan
```

## 9. Automatizar (opcional)
Para correrlo cada X horas en tu VPS con cron:
```bash
crontab -e
```
Agregá (ejemplo cada 6 horas):
```
0 */6 * * * cd /ruta/a/tiktok-scanner && /usr/bin/node scanner.js >> /var/log/tiktok-scanner.log 2>&1
```

## Troubleshooting

| Error | Causa | Solución |
|-------|-------|----------|
| `Falta la variable de entorno: X` | .env no existe o incompleto | Copiar .env.example a .env y completar |
| `Error creando run` | Tablas no existen | Ejecutar setup.sql en Supabase SQL Editor |
| `Rate limit persistente` | TikAPI rate limit por minuto | Subir `REQUEST_DELAY_MS` a 10000 o 15000 |
| `429 en todos los hashtags` | Delay muy corto para tu plan | Subir `REQUEST_DELAY_MS=10000` y bajar hashtags |
| `Hashtag no encontrado` | Hashtag no existe en TikTok | Verificar nombre en tiktok.com |
| `new row violates row-level security` | RLS activado en Supabase | Desactivar RLS en las 4 tablas o crear policy |

### Desactivar RLS (importante si usás anon key)
En Supabase SQL Editor:
```sql
ALTER TABLE tiktok_videos DISABLE ROW LEVEL SECURITY;
ALTER TABLE video_hashtags DISABLE ROW LEVEL SECURITY;
ALTER TABLE scan_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE top_videos DISABLE ROW LEVEL SECURITY;
```

O mejor, crear policies:
```sql
CREATE POLICY "Allow all for anon" ON tiktok_videos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON video_hashtags FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON scan_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON top_videos FOR ALL USING (true) WITH CHECK (true);
```

# CLAUDE.md — TikTok Roblox Scanner

## Qué es este proyecto
Scanner de contenido TikTok de Roblox que consume TikAPI para buscar videos por hashtags, los guarda en Supabase deduplicados, y genera un Top 30 por engagement.

## Stack
- **Runtime**: Node.js 18+ (ESM modules)
- **API**: TikAPI (npm `tikapi`) — API no oficial de TikTok
- **Database**: Supabase (PostgreSQL)
- **Config**: dotenv + hashtags.json

## Estructura
```
tiktok-scanner/
├── scanner.js        # Script principal — escanea, deduplica, guarda, rankea
├── hashtags.json     # Lista de hashtags a escanear (editable)
├── setup.sql         # SQL para crear tablas en Supabase (ejecutar manualmente)
├── package.json      # Dependencias: tikapi, @supabase/supabase-js, dotenv
├── .env              # Keys (NO commitear) — copiar de .env.example
├── .env.example      # Template de variables de entorno
└── CLAUDE.md         # Este archivo
```

## Tablas Supabase
- `tiktok_videos` — Videos únicos (PK: video_id). Campos: description, create_time, views, likes, comments, author_username, hashtags_found[]
- `video_hashtags` — Relación N:M video↔hashtag. UNIQUE(video_id, hashtag)
- `scan_runs` — Log de cada ejecución con stats
- `top_videos` — Snapshot del Top N por run_id

## Flujo del scanner
1. Carga IDs existentes de Supabase → Set en memoria
2. Crea registro de run en `scan_runs`
3. Por cada hashtag en `hashtags.json`:
   - Primera request con `name` → obtiene hashtagId + primera página (~30 videos)
   - Pagina con `response.nextItems()` (SDK method, maneja cursor internamente) hasta MAX_PAGES
   - Cada video se chequea contra el Set en memoria (dedup instantáneo)
   - Videos nuevos se guardan en batch de 50 con upsert
4. Genera Top N (configurable vía TOP_LIMIT) con score compuesto: `views + likes*10 + comments*20`
5. Guarda snapshot del top en `top_videos` vinculado al run

## Paginación de TikAPI (importante)
- TikTok limita a ~30 items por request, no es límite de TikAPI
- Para obtener más, hay que paginar con cursor/offset
- El SDK tiene `response.nextItems()` que maneja esto automáticamente
- `nextItems()` devuelve null cuando no hay más items
- Cada página = 1 request a TikAPI = consumo de créditos

## Deduplicación (3 capas)
1. **Set en memoria** — Se cargan IDs de DB al inicio + se agregan en tiempo real
2. **Upsert Supabase** — `onConflict: 'video_id'` como segunda barrera
3. **UNIQUE constraint** — En `video_hashtags(video_id, hashtag)` evita duplicar relaciones

## TikAPI — Estructura del response
El endpoint `api.public.hashtag()` puede devolver datos en dos formatos:
- `response.json.itemList` (directo)
- `response.json.itemStruct.itemList` (nested)
Lo mismo aplica para `cursor` y `hasMore`. El código maneja ambos con helpers.

Campos relevantes por video en `itemList`:
```
item.id                    → video_id
item.desc                  → description
item.createTime            → unix timestamp en segundos
item.stats.playCount       → views
item.stats.diggCount       → likes
item.stats.commentCount    → comments
item.author.uniqueId       → username
item.author.nickname       → display name
```

## Comandos
```bash
npm install            # Instalar dependencias
npm run scan           # Ejecutar scanner
```

## Rate Limiting
TikAPI tiene rate limits por minuto (sliding window) que varían por plan.
Trial/Starter: probablemente ~5-10 req/min. Pagos más altos.
- Toda request a TikAPI pasa por `rateLimitedCall()` — wrapper con retry + backoff
- `REQUEST_DELAY_MS` (default 6000) = delay entre CADA request individual
- Backoff exponencial en 429: 10s, 20s, 30s, 40s (max 60s)
- Máximo 4 reintentos por 429 antes de saltar al siguiente
- Si tu plan permite más, bajá REQUEST_DELAY_MS a 3000 o 2000

## Variables de entorno
- `TIKAPI_KEY` — API key de tikapi.io
- `SUPABASE_URL` — URL del proyecto Supabase
- `SUPABASE_KEY` — Anon key de Supabase (no service_role)
- `MAX_PAGES_PER_HASHTAG` — Páginas por hashtag (default 5, ~150 videos)
- `TOP_LIMIT` — Cantidad de videos en el ranking (default 50, configurable)
- `REQUEST_DELAY_MS` — Milisegundos entre cada request a TikAPI (default 6000)

## Notas para desarrollo
- Los hashtags se editan en `hashtags.json`, no en código
- El score del Top 30 es configurable en `generateTop30()`
- Para testing, usar `MAX_PAGES_PER_HASHTAG=1` en .env
- TikAPI tiene sandbox mode para testing sin gastar créditos: usar key `DemoAPIKeyTokenSeHYGXDfd4SFD320Sc39Asd0Sc39Asd4s`
- Si Supabase tira error en el insert del run, probablemente faltan las tablas → ejecutar setup.sql

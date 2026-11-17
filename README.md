# LOL Analyzer

Un analizador de perfiles de **League of Legends** hecho con **HTML, CSS y JavaScript vanilla**. Su objetivo es **practicar JavaScript** consumiendo una API real (Riot Games API), manipulando el DOM y organizando datos.

## ¿De qué se trata?

Este proyecto permite buscar un invocador por `Nombre + Tag` (Riot ID), obtener su información de perfil, estadísticas en clasificatorias (Solo/Dúo y Flexible) y su historial reciente de partidas, mostrando los datos de una forma más clara.

## Tecnologías utilizadas

- **HTML5** - Estructura de la página
- **CSS3** - Estilos
- **JavaScript (ES6+)** - Lógica, `fetch`, `async/await`, Promesas
- **Riot Games API** - Obtención de datos del juego

## Estructura del proyecto

```text
lol analyzer/
├── index.html          # Estructura y maquetado de la app
├── styles.css          # Estilos
├── script.js           # Lógica para consumir el proxy y renderizar
├── lol-analyzer.txt    # Archivo auxiliar
└── holy-mouse-2e50/    # Cloudflare Worker que hace de proxy de la Riot API
                      # (se publica como "lol-analyzer-api")
    ├── src/index.js    # Lógica del proxy (lista blanca, CORS, cache, rate limit)
    ├── test/           # Tests del proxy
    └── wrangler.jsonc  # Configuración de Wrangler
```

## ¿Cómo funciona?

El flujo principal que sigue `script.js` es:

1. **Búsqueda** (`getProfile`) - Toma `#nombreInvocador` y `#tag` del formulario, consulta `account/v1/accounts/by-riot-id/...` para obtener el `puuid`.
2. **Construcción del perfil** (`buildProfile`) - Con el `puuid` hace llamadas en paralelo con `Promise.all` a:
   - `summoner/v4/summoners/by-puuid` (nivel)
   - `league/v4/entries/by-puuid` (rango/LPs en Solo/Dúo y Flex)
   - `champion-mastery/v4/champion-masteries/by-puuid` (maestrías)
   - `getFullMatchHistory` (historial de partidas)
3. **Historial** - Obtiene IDs con `match/v5/matches/by-puuid/.../ids`, luego detalles de cada partida con `match/v5/matches/{matchId}` y los "cura" con `getCureMatchHistory` para quedarnos solo con lo útil (KDA, campeón, items, runas, oro, daño, CS, visión, etc.).
4. **Renderizado** (`Profile`) - Muestra nombre, nivel y estadísticas ranked en el DOM.

## Endpoints usados

El navegador **no** llama a Riot directamente: llama al Worker, que usa el mismo
path y le agrega el header `X-Riot-Token`.

| Path en el Worker | Endpoint real de Riot | Uso |
| --- | --- | --- |
| `/americas/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` | `https://americas.api.riotgames.com/...` | Obtener cuenta/Riot ID (puuid) |
| `/americas/riot/account/v1/accounts/by-puuid/{puuid}` | `https://americas.api.riotgames.com/...` | Obtener cuenta por puuid |
| `/la2/lol/summoner/v4/summoners/by-puuid/{puuid}` | `https://la2.api.riotgames.com/...` | Datos de invocador (nivel) |
| `/la2/lol/league/v4/entries/by-puuid/{puuid}` | `https://la2.api.riotgames.com/...` | Clasificatorias |
| `/la2/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}` | `https://la2.api.riotgames.com/...` | Maestrías de campeones |
| `/americas/lol/match/v5/matches/by-puuid/{puuid}/ids` | `https://americas.api.riotgames.com/...` | Lista de partidas recientes |
| `/americas/lol/match/v5/matches/{matchId}` | `https://americas.api.riotgames.com/...` | Detalle de partida |

> Nota: el primer segmento es la **región** (`americas`, `asia`, `europe`, `sea`
> para account/match; `la2`, `la1`, `na1`, `br1`, `euw1`, etc. para el resto).
> El Worker solo acepta esas regiones y los paths de la tabla; cualquier otro
> endpoint devuelve `404`.

## Cómo ejecutar el proyecto

1. Clona o descarga este repositorio
2. Despliega el Worker (ver [Proxy con Cloudflare Worker](#proxy-con-cloudflare-worker))
3. Pega la URL del Worker en `script.js` (`API_BASE`)
4. Abre `index.html` en el navegador (o sirve la carpeta con Live Server)

## Proxy con Cloudflare Worker

La API key vive **solo** como secreto del Worker, nunca en el navegador.

```bash
cd holy-mouse-2e50
npm install

# 1) login (una sola vez)
npx wrangler login

# 2) guardar la key como secreto (no se sube al repo)
npx wrangler secret put RIOT_API_KEY
# pega la key cuando la pida

# 3) desarrollo local
npm run dev        # http://localhost:8787

# 4) publicar
npm run deploy     # imprime la URL publica del Worker
```

Después de `npm run deploy`, copia la URL (algo como
`https://lol-analyzer-api.tu-subdominio.workers.dev`) en `script.js`:

```js
const API_BASE = "https://lol-analyzer-api.tu-subdominio.workers.dev";
```

### Variables opcionales del Worker

Se configuran en `wrangler.jsonc` (bloque `vars`) o con `wrangler secret put` si
son sensibles:

| Variable | Default | Para qué sirve |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `*` | Lista de orígenes permitidos separados por coma. En producción conviene poner el dominio real de la app. |
| `RATE_LIMIT_MAX` | `120` | Requests por IP dentro de la ventana. |
| `RATE_LIMIT_WINDOW` | `60` | Ventana del rate limit en segundos. |

### Qué protege el Worker

- **Lista blanca de endpoints**: no es un proxy abierto, solo responde a los
  paths que usa la app.
- **La key no se filtra**: nunca se devuelve en la respuesta ni se loguea.
- **CORS**: opcionalmente restringido a tu dominio con `ALLOWED_ORIGINS`.
- **Cache** (`caches.default`): las partidas cerradas se cachean 1 día, lo que
  ahorra muchísimo cupo de la key.
- **Rate limit** por IP en memoria (best effort). Para algo serio, suma una
  regla de *Rate Limiting* en el panel de Cloudflare (Security → WAF).

> Ojo: cualquier persona que conozca la URL del Worker puede consumir tu key
> dentro de esos endpoints. Si la app es pública, conviene acompañar el proxy
> con la regla de WAF y, si hace falta, autenticación propia.


## Cosas para practicar con este proyecto

Este repo está pensado como ejercicio de práctica, puedes ir agregando mejoras poco a poco:

- [ ] **Manejo de errores**: Mostrar mensajes si el invocador no existe o si falla la API
- [ ] **Validación de formulario**: Evitar búsquedas vacías
- [ ] **Cargar más partidas**: Usar el botón `#cargarMasPartidas` para paginar
- [ ] **Renderizar historial**: Completar el render del historial usando la plantilla `#plantillaPartida`
- [ ] **Iconos de rango**: Mostrar emblemas con las URLs de Riot
- [ ] **Datos de maestrías**: Mostrar top campeones en el perfil
- [ ] **Loading states**: Deshabilitar botón mientras se busca
- [ ] **Refactor**: Modularizar funciones, evitar código repetido
- [ ] **Seguridad**: Nunca subir claves reales a repos públicos
- [x] **Seguridad**: Mover la API key a un Cloudflare Worker (proxy)

## Aprendizajes clave

- Consumo de APIs REST con `fetch`
- Uso de `async/await` y `Promise.all` para peticiones en paralelo
- Navegación entre distintos endpoints de Riot
- Limpieza/transformación de datos (`getCureMatchHistory`)
- Manipulación del DOM para renderizar información dinámica
- Organización de lógica por responsabilidades

## Licencia

Este proyecto está bajo la **Licencia IMT**. Solo para fines educativos y de práctica.

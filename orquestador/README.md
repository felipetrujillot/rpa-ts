MIGRACIONES

npx nuxt db generate
npx nuxt db migrate

ORQUESTADOR CONTROLA EL SERVER

## Imágenes de referencia

El editor de flujos incluye una biblioteca de imágenes por empresa en la pestaña
**Imágenes**. Usa disco local y una interfaz de almacenamiento preparada para
agregar un bucket. Configuración, API y alcance en [image-assets.md](../docs/image-assets.md).

En desarrollo usa `orquestador/.data/assets`; configura una ruta absoluta con
`NUXT_ASSETS_LOCAL_DIRECTORY`. En Docker se utiliza el volumen persistente
`asset_data` montado en `/var/lib/rpa/assets`.

Para guardar las imágenes en Azure Blob Storage:

```dotenv
NUXT_ASSETS_PROVIDER=azure
NUXT_ASSETS_AZURE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
NUXT_ASSETS_AZURE_CONTAINER=rpa-assets
```

El contenedor se crea privado si no existe; el navegador y el robot nunca reciben
credenciales ni URLs de Azure, todo pasa por `/api/assets`.

## Despliegue con Docker Compose

Este proyecto incluye un `docker-compose.yml` que levanta 3 servicios: `mysql`, `phpmyadmin` y `app` (el propio Nuxt), pensado para desplegar fácilmente en una VM.

### Requisitos

- Docker y Docker Compose v2 instalados en la VM.
- El build se hace con contexto en la raíz del monorepo (usa el `npm workspaces` de `package.json` raíz), así que el repo debe clonarse completo (no solo la carpeta `orquestador`).

### Variables de entorno

Copia el archivo de ejemplo y ajusta los valores antes de desplegar:

```bash
cd orquestador
cp .env.docker.example .env
```

Variables disponibles:

| Variable              | Descripción                                        | Default    |
| --------------------- | -------------------------------------------------- | ---------- |
| `MYSQL_ROOT_PASSWORD` | Password root de MySQL                             | `rootpass` |
| `MYSQL_DATABASE`      | Base de datos creada al iniciar                    | `rpa`      |
| `MYSQL_PORT`          | Puerto expuesto en el host para MySQL              | `3306`     |
| `PHPMYADMIN_PORT`     | Puerto expuesto en el host para phpMyAdmin         | `8080`     |
| `APP_PORT`            | Puerto expuesto en el host para el Nuxt            | `3000`     |
| `NUXT_JWT_SECRET`     | Secreto para firmar JWT (obligatorio, sin default) | —          |

> Nota: si ya tienes un `orquestador/.env` de desarrollo con `NUXT_JWT_SECRET`, Docker Compose lo lee automáticamente (por estar en la misma carpeta) y reutiliza ese valor. Si prefieres separarlo, usa `docker compose --env-file .env.docker up -d --build` con un archivo distinto.

### Levantar el stack

```bash
cd orquestador
docker compose up -d --build
```

- `app` queda disponible en `http://<vm>:${APP_PORT:-3000}`.
- `phpmyadmin` queda disponible en `http://<vm>:${PHPMYADMIN_PORT:-8080}` (usuario `root` y la password de `MYSQL_ROOT_PASSWORD`).
- Los datos de MySQL persisten en el volumen `mysql_data` entre reinicios.
- Las migraciones de la base de datos las aplica automáticamente `@nuxthub/core` al iniciar el servidor.

### Actualizar el despliegue

```bash
git pull
docker compose up -d --build
```

### Detener / limpiar

```bash
docker compose down          # detiene los contenedores, conserva los datos de MySQL
docker compose down -v       # elimina mysql_data y asset_data (BD e imágenes)
```

# Imágenes de referencia

El editor de flujos incluye la pestaña **Imágenes**, una biblioteca compartida por
empresa. Permite subir imágenes, previsualizarlas y copiar su `assetId`. La carga
se guarda inmediatamente, sin depender de guardar el borrador del flujo.

El canvas incluye la acción **Buscar y hacer clic por imagen**, que utiliza estas
referencias. Sube un recorte del botón o sección que quieras encontrar; la biblioteca
conserva la imagen original y no incluye herramientas de recorte.

## Agregar el paso al canvas

1. Abre el editor de un flujo y agrega una acción de **Escritorio**.
2. Busca **Buscar y hacer clic por imagen** (`cua.image.click`).
3. En **Imagen de referencia**, pulsa **Elegir o subir imagen**. Puedes elegir una
   imagen existente, subir una nueva o pegar su ID. El flujo guarda solo `assetId`.
4. Elige `scope: window` e indica el PID e ID de ventana obtenidos con **Listar
   ventanas** o **Esperar una ventana o diálogo**. `scope: desktop` busca en la
   pantalla principal y no requiere esos IDs.
5. Aplica los cambios, conecta el paso y guarda el flujo.

El robot debe estar vinculado al mismo orquestador y tener CUA Driver instalado
con sus permisos. No hacen falta Python, un servicio de modelos ni una extensión
de percepción de CUA: OpenCV.js y Sharp se instalan con las dependencias del robot.

| Entrada           | Valor inicial                | Uso                                                                                                 |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `assetId`         | vacío                        | ID de la imagen de referencia. También admite referencia a una variable.                            |
| `scope`           | `window`                     | Ventana exacta o escritorio principal.                                                              |
| `pid`, `windowId` | `0`                          | Identificadores del destino; sustituir por los reales para `window`.                                |
| `minSimilarity`   | `0.9`                        | Umbral entre 0.5 y 1; es similitud, no probabilidad de acierto.                                     |
| `timeoutMs`       | `10000`                      | Entre 1000 y 60000 ms de búsqueda, después de obtener la referencia.                                |
| `scales`          | `0.5,0.67,0.75,1,1.25,1.5,2` | Entre 1 y 20 tamaños relativos, cada uno entre 0.25 y 4.                                            |
| `region`          | omitida                      | Objeto JSON `{ "x": 0, "y": 0, "width": 500, "height": 300 }` en píxeles de la captura del destino. |
| `button`, `count` | `left`, `1`                  | Botón y cantidad de clics (1 a 3).                                                                  |
| `deliveryMode`    | `background`                 | Modo CUA, sin cambio automático a primer plano.                                                     |

La búsqueda usa correlación normalizada de OpenCV junto con una comprobación de
diferencias de color. Agrupa picos de la misma coincidencia entre escalas y exige
un único destino. Las referencias uniformes se rechazan; el texto o bordes de un
botón ayudan a distinguirlo. Cambios grandes de tema, diseño o escala pueden
requerir otro recorte o ajustar `scales`.

Si no hay coincidencias, toma nuevas capturas hasta el límite. Si hay varias, falla
sin hacer clic y pide acotar la región o usar una referencia más específica. El clic
se hace una sola vez en el centro usando el `capture_id` de la captura analizada;
el driver rechaza capturas obsoletas. Nunca se reintenta automáticamente un clic
fallido o de entrega incierta. Cancelar interrumpe el worker e impide emitir un clic
posterior; los efectos ya entregados al sistema no se deshacen.

El tiempo de búsqueda acota las esperas y el motor visual. Una llamada de captura
CUA que ya está en curso debe terminar antes de devolver el error o la cancelación;
si acabó el tiempo, no se hace clic. Un fallo al descargar la referencia detiene el
paso antes de capturar o hacer clic.

La salida contiene `clicked`, `assetId`, `match` (posición, dimensiones, similitud y
escala), centro `x/y`, intentos y `capture_id`, además de la respuesta del driver.
No devuelve los bytes de la imagen ni credenciales.

## Configuración local

```dotenv
NUXT_ASSETS_PROVIDER=local
NUXT_ASSETS_LOCAL_DIRECTORY=/ruta/persistente/rpa/assets
```

Sin configuración, el proveedor es `local` y usa `.data/assets` relativo al
directorio de ejecución del orquestador (normalmente `orquestador/.data/assets`
en desarrollo). La carpeta se crea al subir la primera imagen y está excluida de
Git. No debe servirse como carpeta pública.

La tabla MySQL `assets` guarda empresa, usuario creador, nombre original, MIME,
tamaño, dimensiones, SHA-256, proveedor y clave del objeto. El contenido binario
vive en la carpeta, bajo una clave UUID generada. Los assets son inmutables y no
hay borrado público para evitar romper referencias de versiones de flujos.

Aplica el esquema con el mecanismo habitual del proyecto:

```sh
cd orquestador
npx nuxt db migrate
```

La migración `0011_image_assets` crea una tabla nueva; no migra imágenes ni modifica
flujos existentes. Respaldar los assets requiere conservar **la tabla y la carpeta**.

Docker Compose monta `asset_data` en `/var/lib/rpa/assets` y configura ese directorio
automáticamente. `docker compose down` conserva el volumen; `down -v` lo elimina.

## API

Todas las rutas verifican la sesión vigente y aíslan los datos por empresa. Se
acepta la cookie del panel o `Authorization: Bearer <token>`.

| Método y ruta                     | Acceso                         | Resultado                                                                       |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `POST /api/assets?name=boton.png` | Usuario                        | Sube bytes de imagen y devuelve metadatos con `id` (HTTP 201).                  |
| `GET /api/assets?cursor=<id>`     | Usuario                        | `{ items, nextCursor }`, hasta 50 imágenes. Omitir cursor en la primera página. |
| `GET /api/assets/<id>`            | Usuario o agente de la empresa | Metadatos públicos del asset, incluido SHA-256.                                 |
| `GET /api/assets/<id>/content`    | Usuario o agente de la empresa | Bytes originales con su MIME.                                                   |

El POST recibe el archivo directamente en el cuerpo, con `Content-Type: image/png`,
`image/jpeg` o `image/webp`; no usa multipart ni base64. La validación decodifica la
imagen, exige formato real coincidente, hasta 10 MiB, hasta 25 megapíxeles y una sola
imagen estática. El límite de bytes también se aplica a cargas chunked. SVG no se
admite. Si falla la inserción de metadatos, se elimina el archivo recién creado.

Las respuestas de metadatos no exponen rutas ni claves de almacenamiento. Las
descargas privadas no se cachean por HTTP para comprobar revocaciones de sesión en
cada solicitud. El robot guarda una caché privada en `userData/image-assets`,
separada por endpoint e identificada por ID y SHA-256. Antes de leerla vuelve a
autenticar y pedir los metadatos: una sesión revocada o un asset de otra empresa
no puede utilizar la caché. Verifica el hash tanto de la descarga como de los bytes
cacheados; si la copia local está dañada, la vuelve a descargar.

## Azure Blob Storage

Proveedor `azure` incluido (`AzureBlobAssetStorage`). Configuración:

```dotenv
NUXT_ASSETS_PROVIDER=azure
NUXT_ASSETS_AZURE_CONNECTION_STRING=<cadena de conexión de la cuenta>
NUXT_ASSETS_AZURE_CONTAINER=rpa-assets
```

El contenedor se crea privado en la primera carga si no existe. Los blobs usan la
clave UUID y no se sobrescriben. Los registros ya guardados como `local` siguen
leyéndose del disco; no hay migración automática entre proveedores.

## Incorporar otro bucket

`server/assets/storage.ts` define `AssetStorage`: `provider`, `put`, `get` y `delete`.
El servicio de assets depende de esa interfaz, no de llamadas al filesystem.

Para incorporar almacenamiento de objetos:

1. Implementar `AssetStorage` en un adaptador de bucket y agregar sus credenciales
   a la configuración privada del servidor.
2. Registrar el proveedor en `createAssetStorage`.
3. Configurar `NUXT_ASSETS_PROVIDER` con el nombre del proveedor para nuevas cargas.

Las lecturas resuelven el proveedor guardado en cada registro. Los flujos y robots
continúan usando `assetId` y el mismo endpoint autenticado. No se necesitan URLs
públicas ni credenciales del bucket en el navegador o el robot.

No se incluye migración de archivos entre proveedores. En desarrollo se pueden
descartar los assets de prueba al cambiar; si se conservan registros `local`, se
debe conservar también su carpeta y el adaptador local. Un proveedor desconocido
produce un error explícito, sin volver silenciosamente a disco.

# Scripts TypeScript en los flujos

En el editor, agrega una acción de **Lógica → Ejecutar TypeScript**
(`script.typescript.run`). No necesitas instalar Node, paquetes ni un compilador
en el equipo del usuario: el robot incluye el motor y el compilador.

## Entradas y resultados

- `code`: cuerpo del script TypeScript. Admite `return` y `await` directamente.
- `data`: JSON, texto JSON o una referencia a datos de otro paso. Se convierte en
  la variable `input` dentro del script. Por defecto es `{}`.
- `allowedActions`: lista literal de IDs de acciones que puede solicitar el SDK.
  Se configura con el selector **Permisos del SDK**; por defecto está vacía.
- `timeoutMs`: tiempo total, incluida la preparación, las acciones del SDK y HTTP.
  Por defecto 5000 ms; admite enteros entre 100 y 30000.

En **Datos que recibe el script (`input`)**, puedes elegir **Escribir JSON** o
**Usar datos del flujo**. El selector permite usar la entrada inicial, variables
o la salida de un paso conectado antes del script. Los pasos se muestran por
nombre, pero la referencia se guarda con su ID: renombrar el origen o insertar
un paso intermedio no cambia los datos seleccionados. Puedes elegir el resultado
del `return`, la salida completa con logs o un campo concreto. Deja el campo
opcional vacío para recibir el valor completo. **Ver referencia técnica** muestra
la ruta; las referencias existentes siguen funcionando, incluidas las dinámicas
`last` y `json`.

El nodo del diagrama indica el origen de `input`. Al seleccionar un script se
resaltan sus orígenes y aparecen líneas discontinuas de datos; estas líneas son
informativas y no modifican el orden de ejecución. El editor avisa si un origen
desaparece, está deshabilitado o no está conectado antes del script.

**Ver ejemplo de ejecución** permite cargar resultados guardados de las últimas
ejecuciones del flujo. Son valores finales históricos, posiblemente de otra
versión, y no una ejecución del código actual. Las referencias dinámicas `last`
y `json` requieren el estado durante la ejecución y no se simulan con los valores
finales. Las salidas protegidas no se muestran.

```ts
type Pedido = { precio: number; cantidad: number };
const pedidos = input as Pedido[];
const total = pedidos.reduce((suma, p) => suma + p.precio * p.cantidad, 0);
log("Pedidos procesados", pedidos.length);
return { total };
```

El resultado de la acción es `{ result, logs }`. El siguiente paso puede usar
`{{last.result.total}}`, o una referencia como
`{ "$ref": "nodeOutputs.mi-script.result.total" }`.
Cada entrada de `logs` es un arreglo con los argumentos de `log(...)`.
`console.log/info/warn/error` también registran argumentos.
Los logs quedan en la salida del nodo, incluso si el script falla o se cancela,
y se transmiten como parte de la traza existente de ejecución. No son eventos
de consola independientes en tiempo real. Para información confidencial, utiliza
la opción existente de salida sensible del nodo.

El código se trata como texto literal: **no se reemplazan `{{variables}}` dentro
de `code`**. Pasa los valores con `data` y léelos mediante `input`. Así, una
cadena recibida desde una API no puede convertirse en instrucciones del script.

El editor usa Monaco, el componente de edición de VS Code, con resaltado,
autocompletado, información de tipos, diagnósticos, números de línea, búsqueda,
formato y edición ampliada. `Ctrl+Espacio` abre las sugerencias, `Tab` indenta
y `Ctrl+M` (`Ctrl+Shift+M` en macOS) alterna el uso de Tab para salir del editor.
La ayuda describe únicamente las APIs del robot (`input`, `log`, `console`, `http` y `rpa`);
no ofrece APIs de Node ni del navegador.
`input` tiene tipo `unknown`: usa una aserción de tipo para describir los datos que recibes.

El editor comprueba los tipos mientras escribes. Estos avisos son orientativos;
el robot transpila TypeScript al ejecutar, sin bloquear por errores de tipos.
El editor y los workers de lenguaje se cargan desde la propia aplicación, sin CDN.
Los errores de sintaxis incluyen la posición en el código TypeScript; los errores
de ejecución incluyen el stack del JavaScript generado.
La salida debe poder serializarse como JSON: no se admiten ciclos ni `bigint`.
Si no hay `return`, el resultado es `null`.

## SDK de acciones del robot

El global `rpa` permite combinar las acciones existentes con bucles, condiciones y
transformaciones de TypeScript. No requiere imports ni instalar paquetes.
Monaco ofrece autocompletado con `rpa.`, firmas de entrada y tipos de retorno.
Las entradas comparten los contratos del catálogo. Excel, Word y navegador tienen
resultados tipados; las respuestas nativas de escritorio se exponen como
`Record<string, unknown>` y deben comprobarse antes de usarlas.

Cada llamada necesita **dos autorizaciones**:

1. Selecciona sus IDs exactos en **Permisos del SDK** del nodo.
2. En el servidor, abre **Agentes → [robot] → Equipo y acceso → Permisos del SDK**.
   Un administrador selecciona las acciones autorizadas y pulsa **Guardar permisos**.
   La política se guarda por robot y por empresa; inicialmente no permite ninguna acción.

En ambos selectores puedes usar **Habilitar todas** o **Desmarcar todas**.
La selección abarca el catálogo completo, aunque hayas filtrado la búsqueda;
en el editor se limita a las acciones disponibles en ese catálogo. Guarda con
**Aplicar cambios** en el nodo y **Guardar permisos** en el agente. Se guardan
IDs explícitos: las acciones añadidas al SDK en el futuro requieren autorización.

El robot consulta al servidor antes de **cada llamada**, usando su sesión de
vinculación. El código del script no recibe credenciales ni puede modificar esa
política. Se mantienen el permiso del nodo y las comprobaciones de disponibilidad
de la integración. No necesitas variables de entorno ni reiniciar el robot.
`RPA_SCRIPT_ALLOWED_ACTIONS` ya no concede permisos.

Los cambios se aplican a la siguiente llamada, incluso dentro de un script en
curso. Las llamadas ya iniciadas pueden terminar: para detener el flujo utiliza
**Cancelar** y revisa sus efectos. Si el robot está sin vincular, el servidor no
responde o no puede verificar la sesión, no inicia la acción. Los fallos de
verificación se informan como `SCRIPT_POLICY_UNAVAILABLE`; los permisos denegados,
como `SCRIPT_ACTION_DENIED`. Las consultas de autorización forman parte del plazo
total del script. La política también se comprueba para pruebas locales del robot.


```ts
const datos = input as { nombre: string };
const tab = await rpa.browser.openTab({ url: "https://servicio.ejemplo.com" });
await rpa.browser.type({ tabId: tab.tabId, selector: "#nombre", text: datos.nombre });
await rpa.browser.click({ tabId: tab.tabId, selector: "button[type=submit]" });
return { tabId: tab.tabId };
```

También puedes llamar al mismo contrato por su ID:

```ts
const tab = await rpa.actions.execute("playwright.browser.openTab", { url: "https://servicio.ejemplo.com" });
return tab;
```

Las familias disponibles son `rpa.browser.*` (Playwright), `rpa.desktop.*`
(CUA), `rpa.excel.*`, `rpa.word.*` y `rpa.puppeteer.*`. Por ejemplo,
`rpa.excel.range.read(...)`, `rpa.word.document.readText(...)` y
`rpa.desktop.mouse.click(...)`. Puppeteer conserva su disponibilidad existente:
el SDK no instala ni configura integraciones ausentes. Las acciones de Office
que declares también fijan sus requisitos de plugin en la publicación del flujo.
No se permiten comodines, IDs desconocidos, referencias dinámicas en los permisos
ni llamadas recursivas a otros scripts.

Se reutilizan las sesiones del flujo: un libro abierto por un paso visual puede
usarse desde el script con su `workbookId`, y viceversa. Las acciones del SDK se
procesan de una en una, incluso si utilizas `Promise.all`. Hay un máximo de 100
llamadas por script y 4 solicitudes pendientes (compartidas con HTTP en el
intérprete). Usa siempre `await`; terminar con acciones pendientes es un error.
Todo debe terminar dentro del `timeoutMs` del script, con máximo de 30 segundos.

Los errores ordinarios generan `RpaActionError`, con `code` y `actionId`:

```ts
try {
  return await rpa.browser.openTab({ url: "https://servicio.ejemplo.com" });
} catch (error) {
  if (error instanceof RpaActionError && error.code === "ACTION_UNAVAILABLE") {
    return { disponible: false };
  }
  throw error;
}
```

Las llamadas aparecen en **Acciones del SDK** del historial del paso y en
`output.actions`, con estado, duración, error y resultado. No se registran sus
argumentos automáticamente. Cada respuesta admite hasta 1 MiB; la evidencia de
resultados tiene un presupuesto total de 128 KiB, tras el cual se indica que el
resultado fue omitido. La opción de salida sensible protege también estas trazas.

La cancelación se transmite a las acciones, pero algunas integraciones nativas
solo pueden detenerse de forma cooperativa y pueden tardar en finalizar. No hay
rollback ni reintentos automáticos. Si una llamada queda en curso al cancelar,
vence el plazo, devuelve un resultado incompatible o informa efectos inciertos,
el script falla con `ACTION_EFFECT_UNCERTAIN` y el flujo se detiene incluso con
«continuar al fallar». Este error no se puede ocultar con `try/catch` en el script.
Revisa los efectos en la aplicación antes de reintentar.

Los permisos autorizan las capacidades completas de cada acción, como archivos,
portapapeles, cookies o evaluación de JavaScript en una página. La política de
orígenes de `http` se aplica exclusivamente a ese intermediario: no restringe
la navegación ni las solicitudes de las acciones de navegador que autorices.
El script conserva su aislamiento de Node y Electron, y accede a estas
capacidades únicamente mediante las acciones autorizadas del robot.

## HTTP para integraciones

La red está cerrada por defecto. El operador del equipo debe configurar
`RPA_SCRIPT_ALLOWED_ORIGINS` **en el entorno del proceso del robot** y reiniciarlo:

```sh
RPA_SCRIPT_ALLOWED_ORIGINS=https://api.ejemplo.com,https://servicio.ejemplo.com:8443 npm run dev --workspace=@rpa/robot
```

La política pertenece al robot; un flujo descargado no puede agregar destinos.
Solo se aceptan orígenes HTTPS exactos, sin comodines, rutas ni credenciales.
Autorizar un origen permite a los scripts hacer solicitudes a cualquier ruta de
ese origen; configura únicamente servicios que puedan recibir los datos del flujo.

```ts
type Cliente = { id: number; nombre: string };
const datos = input as { clienteId: number; token: string };
const cliente = await http.get<Cliente>(
  `https://api.ejemplo.com/clientes/${encodeURIComponent(datos.clienteId)}`,
  { headers: { Authorization: `Bearer ${datos.token}` } },
);
log("Cliente consultado", cliente.id);
return { nombre: cliente.nombre };
```

APIs disponibles:

- `http.get<T>(url, { headers? }?)`
- `http.post<T>(url, body, { headers? }?)`
- `http.request<T>(url, { method?, headers?, body? }?)`

Devuelven el cuerpo JSON parseado, o texto si no es JSON. Los objetos enviados
como `body` se serializan a JSON. Las respuestas fuera de 200–299 generan error.
No se siguen redirecciones ni se comparte el almacén de cookies del navegador.
Los métodos admitidos son GET, POST, PUT, PATCH, DELETE y HEAD.
Un timeout o una cancelación no revierten los efectos de una solicitud ya enviada.

## Aislamiento y límites

El código del usuario se ejecuta en QuickJS compilado a WebAssembly, dentro de
un worker nuevo por ejecución. No se ejecuta mediante `eval` de Node ni `node:vm`.
El bootstrap del worker es código de confianza; únicamente cadenas JSON cruzan
la frontera entre el intérprete y las funciones del robot.

- Sin acceso directo a Node, Electron, archivos, variables de entorno, shell, DOM,
  `fetch`, WebSocket, instalación de paquetes ni carga de módulos.
- `Function` y `eval`, si se utilizan dentro del script, permanecen en QuickJS.
- Heap de QuickJS configurado a 32 MiB y memoria WASM limitada a 64 MiB.
  El worker tiene además un límite de heap V8 de 128 MiB; estas cifras no son
  un límite total de memoria del proceso Electron.
- Interrupciones del intérprete y terminación del worker desde el robot al
  cancelar o vencer el plazo. La terminación también cubre bucles y promesas
  que nunca se resuelven.
- Código de hasta 64 KiB; entrada y resultado de hasta 1 MiB cada uno.
- Máximo 100 entradas de log y 64 KiB de logs serializados.
- Máximo 20 solicitudes HTTP y 4 solicitudes simultáneas; cuerpos de hasta
  256 KiB y respuestas de hasta 1 MiB por solicitud.
- HTTP bloquea direcciones locales, privadas y reservadas, incluidos metadatos
  de nube y representaciones IPv4 en IPv6. Valida todas las respuestas DNS y
  fija la IP validada para conectar, manteniendo la verificación TLS del hostname.
- No se permite sobrescribir cabeceras de enrutamiento como Host o usar proxies
  mediante cabeceras HTTP.

Este aislamiento limita las capacidades del script; no es una máquina virtual
del sistema operativo. Las solicitudes de `http` se controlan mediante su intermediario; el SDK
se controla mediante las autorizaciones de acciones, no mediante permisos del worker de Node. Los permisos existentes para editar,
publicar y ejecutar flujos siguen siendo relevantes: cualquier flujo autorizado
puede usar esta acción y los destinos autorizados en su robot.

QuickJS, sus archivos WASM, `ipaddr.js` y TypeScript deben incluirse como
dependencias de producción al distribuir la aplicación.

## Migración del servidor

Antes de desplegar esta versión, aplica la migración `0012_script_action_policy`
mediante `npx nuxt db migrate` desde `orquestador`. Añade la columna JSON de
permisos al agente; los robots existentes empiezan sin acciones autorizadas.
Los cambios quedan registrados en la auditoría como `script.policy.updated`.
La política de orígenes HTTPS de `http` mantiene su configuración independiente.

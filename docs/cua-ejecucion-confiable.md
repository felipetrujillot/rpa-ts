# CUA y ejecución confiable

El robot integra CUA Driver mediante su CLI oficial: invoca `call <tool>` como proceso hijo, envía argumentos JSON por stdin y procesa su respuesta estructurada. CUA reemplaza completamente la integración anterior de RobotJS; ya no hay dependencia nativa ni reconstrucción para Electron. El adaptador resuelve el binario según la plataforma, permite configurar `CUA_DRIVER_PATH` y crea una sesión por ejecución. Referencia del driver: https://github.com/trycua/cua/tree/main/libs/cua-driver.

## Instalación y permisos

Instalar CUA Driver **0.38.0**, versión utilizada en esta validación, siguiendo las instrucciones oficiales para el sistema operativo. El instalador del robot todavía no distribuye ni actualiza el driver. Si el ejecutable no está en PATH o en una ruta reconocida, configurar `CUA_DRIVER_PATH` en el entorno del proceso principal de Electron.

En este Mac se instaló `/Applications/CuaDriver.app`; Accesibilidad y Grabación de pantalla están autorizadas para CuaDriver. La telemetría quedó deshabilitada. Para verificar el entorno:

```sh
/Applications/CuaDriver.app/Contents/MacOS/cua-driver doctor --json
/Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions status
```

Si faltan permisos, ejecutar `cua-driver permissions grant`, habilitarlos en Ajustes del Sistema y reiniciar el driver con el procedimiento oficial. La integración no evita los controles de permisos del sistema.

Windows y Linux utilizan el mismo transporte y acciones, pero necesitan su binario, sesión gráfica interactiva y configuración de accesibilidad correspondiente. Los roles, etiquetas, rutas de aplicación y teclas deben definirse por plataforma. Esta etapa **solo valida ejecución nativa en macOS arm64**; falta realizar los flujos equivalentes en Windows y Linux. No se ha probado un servicio de Windows sin sesión gráfica ni escritorios bloqueados.

## Documento y contratos

Los flujos utilizan exclusivamente el contrato v2 de `@rpa/contracts`; el protocolo de mensajes lleva `protocolVersion: 2`. Consulta [workflows v2](workflow-v2.md) para el schema, diseñador e instrucciones de actualización.

## Acciones y evidencia

El catálogo contiene 29 acciones. Sus nombres, campos, descripciones y entradas sugeridas se definen en `packages/contracts/src/cua.ts` y se comparten entre el registro del robot y el editor de flujos, incluso al editar sin un agente conectado.

| Grupo | Acciones |
| --- | --- |
| Aplicaciones | `cua.apps.list`, `cua.app.launch`, `cua.windows.list`, `cua.windows.waitFor` |
| Ventanas | `cua.window.capture`, `cua.window.focus`, `cua.window.setFrame`, `cua.window.zoom` |
| Controles accesibles | `cua.element.click`, `cua.element.doubleClick`, `cua.element.setValue` |
| Texto, teclas y menús | `cua.text.type`, `cua.key.press`, `cua.key.hotkey`, `cua.menu.invoke` |
| Escritorio | `cua.desktop.capture`, `cua.desktop.tree`, `cua.screen.size` |
| Cursor y ratón | `cua.cursor.position`, `cua.cursor.move`, `cua.mouse.click`, `cua.mouse.drag`, `cua.mouse.scroll` |
| Portapapeles | `cua.clipboard.read`, `cua.clipboard.write` |
| Comprobaciones | `cua.window.assert`, `cua.window.assertVisualText`, `cua.window.verify`, `cua.window.visualRegions` |

`cua.app.launch` acepta `urls` como una lista separada por comas. `cua.windows.waitFor` busca por aplicación, PID o fragmento del título, espera hasta 30 segundos y devuelve el registro de ventana encontrado; guarda `window.pid` y `window.window_id` para acciones posteriores. `cua.window.verify` ofrece comprobaciones de existencia, valor, estado habilitado o selección con espera acotada de hasta 10 segundos. Un resultado `unsatisfied` o `unknown` falla el nodo; nunca se interpreta como verificado.

`cua.window.visualRegions` toma una captura nueva y llama `parse_visual_regions` para devolver regiones de texto e iconos. Requiere que esté instalada la extensión local de percepción; sin ella el nodo falla con el error del driver. Esta extensión opcional incluye un componente AGPL-3.0, por lo que hay que revisar sus términos antes de redistribuirla con el producto. La captura visual no hace clic: usa la etiqueta o región devuelta para decidir el siguiente paso. La versión validada del driver no ofrece selección de monitores; `cua.desktop.capture` y las acciones desktop usan la pantalla principal.

Las acciones de texto, teclas, cursor y ratón aceptan `scope: "window"` (predeterminado), con `pid` y `windowId` explícitos, o `scope: "desktop"`, que debe elegirse expresamente. En escritorio se ignoran esos IDs: texto y teclas van a la aplicación activa. En ventana, `cua.text.type` puede usar el control enfocado o seleccionar una etiqueta/rol exactos; la selección debe coincidir una sola vez y usa un token nuevo de accesibilidad. Los clics y la asignación de valores por elemento también resuelven un token nuevo.

Las coordenadas de ratón son píxeles de la captura del destino: `cua.window.capture` para ventana o `cua.desktop.capture` para escritorio. No son intercambiables con los puntos lógicos devueltos por `cua.cursor.position` y `cua.screen.size`. `cua.cursor.move` en ventana mueve el cursor visual del agente; en escritorio mueve el puntero real. `cua.window.setFrame` usa las unidades de geometría devueltas por `cua.windows.list`. El modo predeterminado es `background`; `foreground` se selecciona explícitamente y nunca se intenta automáticamente tras un fallo. Traer una ventana al frente es una acción explícita independiente.

`cua.key.press.modifiers`, `cua.key.hotkey.keys` y `cua.app.launch.urls` admiten listas de textos o texto separado por comas (por ejemplo `cmd,shift,s`). El portapapeles solo devuelve texto con `includeText: true`; al escribir admite `format: text`, `image` o `file`, con `value` como texto o ruta absoluta. El inspector explica campos y destinos, y al cambiar de acción carga las entradas iniciales de la nueva acción.

Se retiraron las acciones `robotjs.*`, `robot.window.screenshot` y la demo sinusoidal que ya no ejecutaba movimiento. Para capturas del escritorio se usa `cua.desktop.capture`; para una ventana específica, `cua.window.capture`. No hay alias ni migración automática de flujos antiguos. La captura interna de la ventana Electron usada por la telemetría mantiene su canal independiente.

Las dependencias se instalan desde la raíz del monorepo con `npm ci` y su `package-lock.json`; se retiró el lockfile obsoleto del workspace robot. El catálogo no expone las herramientas administrativas del driver (actualización, instalación de extensiones o configuración de permisos). La automatización web sigue disponible mediante Playwright y Puppeteer.

`cua.window.assert` comprueba el valor o etiqueta accesible exactos y exige una captura. `cua.window.assertVisualText` usa Apple Vision local, exige una coincidencia exacta con confianza mínima 0,9 y permite limitar la región vertical. Este OCR requiere macOS y las herramientas de línea de comandos de Swift instaladas; el empaquetado de un auxiliar nativo compilado queda pendiente. No se envían imágenes a un servicio de modelos. Windows/Linux pueden usar la comprobación accesible; aún no incluyen un motor OCR equivalente.

Desde la raíz:

```sh
npm run test:desktop --workspace=@rpa/robot
```

Las pruebas ejecutan los documentos JSON de `robot/examples/` mediante el motor de flujos real. Calculadora se configura en modo básico, opera 6 × 7 y comprueba 42 mediante OCR de su captura. TextEdit abre un archivo nuevo dentro de la carpeta de artefactos, escribe texto, verifica el valor accesible y su captura, guarda con Cmd+S y comprueba el contenido del archivo en disco. Las etiquetas del fixture corresponden a las aplicaciones en inglés utilizadas en este equipo.

Se generan `robot/artifacts/desktop/calculator.png`, `textedit.png` y reportes JSON con resultado esperado/observado, método, ventana, plataforma y nodos. Los archivos de TextEdit son únicos por prueba. Las ventanas permanecen disponibles para inspección; las sesiones CUA de las pruebas se cierran. Esta carpeta está excluida de Git. `RPA_DESKTOP_ARTIFACTS` permite cambiar el destino.

## Protocolo persistente

1. El servidor reserva el agente bajo bloqueo transaccional de su fila, asigna un token de reserva y persiste el comando con una copia del documento y sus entradas. Solo hay una reserva activa por dispositivo.
2. El robot persiste el comando en `execution-journal`, dentro de `app.getPath('userData')`, antes de enviar `command_ack`. Los registros se escriben mediante archivo temporal, fsync y renombrado; se deduplican por ID y huella del contenido inmutable.
3. El servidor confirma `command_accepted` después de guardar la aceptación. El robot espera esta respuesta antes de iniciar efectos y escribe el estado `running` en el diario antes de invocar el flujo. Si la respuesta se pierde, se espera un reenvío; nunca se ejecuta por asumir que el ACK llegó.
4. El heartbeat solicita renovar la reserva cada 10 segundos; su duración es 60 segundos. El proceso principal mantiene el temporizador incluso si se recarga la interfaz. Al expirar solicita cancelación y espera que la acción activa termine antes de liberar su controlador local.
5. El robot guarda el resultado terminal y lo reenvía hasta recibir `flow_run_receipt`. El servidor comprueba empresa, agente, comando y token; persiste el resultado y libera la reserva. Los mensajes repetidos no revierten un estado terminal ni vuelven a ejecutar el comando.
6. Una cancelación también es un comando persistente. Una cancelación recibida antes de iniciar impide el arranque; durante la ejecución solicita detención y espera su terminación. Cancelar no deshace los efectos previos.

Los eventos de inicio y fin de cada nodo se escriben durante la ejecución en `telemetry-outbox`, con fsync antes de continuar. Electron notifica al renderer para transmitirlos inmediatamente, y el heartbeat reintenta la entrega. El servidor confirma cada evento con `telemetry_receipt`; el archivo local solo se elimina tras ese recibo. El envío es al menos una vez y la persistencia central es idempotente.

Las capturas viajan como artefactos separados, referenciados por `$artifact` en los resultados. Los resultados y trazas centrales se consultan con autorización por empresa. El diario conserva la deduplicación local y resultados con secretos ocultos y referencias a artefactos. Sus entradas de comando siguen siendo datos de ejecución, con permisos restrictivos pero sin cifrado adicional. Ver [persistencia operativa](persistencia-operativa.md) para retención, límites y pendientes de producción.

## Recuperación y revisión

Al reconectar se reenvía el mismo ID, documento y token. El robot puede continuar un comando aceptado que todavía no empezó. Si el proceso cayó después de persistir `running`, se marca `EXECUTION_INTERRUPTED` y **no se repite automáticamente**. Si el servidor ya aceptó un comando pero falta su diario local, se aplica la misma regla. Las excepciones de transporte con resultado incierto también exigen revisión. Una cancelación posterior conserva ese resultado incierto.

El resultado incierto mantiene la reserva con `requires_reconciliation`. El panel del agente muestra la advertencia y exige marcar que la ejecución se detuvo y sus efectos fueron revisados antes de liberar la reserva. El servidor comprueba empresa y ejecución, y exige que hayan pasado 30 segundos desde el vencimiento de la reserva. El vencimiento por sí solo nunca habilita otro trabajo. Una partición prolongada puede dejar la cola detenida hasta reconectar o revisar el equipo.

El robot también muestra esta advertencia en todas sus vistas, con acceso al detalle, cuenta regresiva y el botón **Reanudar cola**. Tras confirmar la revisión, detiene las ejecuciones locales, comprueba que no quede una ejecución remota activa y solicita liberar únicamente la reserva revisada del agente vinculado. La liberación queda auditada y despacha el siguiente flujo; el fallido no se repite. Los fallos ordinarios liberan la cola automáticamente. En particular, `APP_NOT_INSTALLED` al abrir una aplicación y las respuestas explícitas `effect: refused` son rechazos conocidos; una CLI terminada por señal, tiempo agotado o fallo ambiguo sigue exigiendo revisión.

El protocolo evita repetir automáticamente trabajo incierto; no ofrece atomicidad entre un efecto sobre una aplicación externa y su confirmación en el diario. Un flujo que realiza pagos, envíos u otros efectos debe incorporar su propia comprobación de negocio antes de un reintento manual. En CUA, cerrar una sesión o detener la CLI no revierte una acción que ya recibió el sistema operativo.

## Actualización y pruebas

Actualizar servidor y robots juntos, con los trabajadores detenidos. Aplicar `0006_durable_execution.sql`, `0007_workflow_nodes_v2.sql` y `0008_operational_telemetry.sql` mediante el procedimiento de migración del entorno. Crea `agent_commands` y `agent_reservations` y marca fallidas las ejecuciones activas del protocolo anterior: revisar sus efectos antes de reintentarlas. Las pruebas utilizaron una base MariaDB desechable en Docker; **no se aplicaron migraciones a la base de desarrollo**.

```sh
npm test
npm run typecheck
npm run test:integration
RPA_BROWSER_CHANNEL=chrome npm run test:browser --workspace=@rpa/robot
npm run build --workspaces
```

La cobertura incluye entrega concurrente, recibos perdidos, reinicio del diario, cancelación previa, admisión confirmada, pérdida de conexión antes de admitir, reserva vencida, tokens incorrectos, aislamiento entre empresas y liberación tras revisión. La integración invoca los handlers WebSocket reales con peers simulados; falta una prueba de extremo a extremo del robot vinculado contra el servidor desplegado y su proxy. Los sockets, tickets y límites por IP todavía requieren un único proceso de orquestación.

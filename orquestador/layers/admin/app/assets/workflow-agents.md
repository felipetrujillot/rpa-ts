# AGENTS.md — Generar flujos RPA desde una necesidad en texto

## Tu tarea

Convierte la necesidad del usuario en un archivo JSON importable en el creador de flujos. Usa exclusivamente el contrato `rpa.workflow` con `schemaVersion: "2.0.0"` descrito aquí.

1. Identifica el objetivo, los datos de entrada, los pasos y el resultado esperado.
2. Si faltan datos imprescindibles, pregunta antes de generar el archivo: sistema operativo del robot, aplicación o URL, selectores reales, rutas, datos que se escribirán, condiciones y criterio de éxito. No inventes selectores, IDs de ventanas, campos de salida ni acciones.
3. Usa solo acciones del catálogo incluido y confirma que estén disponibles en el robot de destino. Que una acción figure en el editor no garantiza que el robot tenga su integración conectada.
4. Construye un grafo conectado desde un único inicio manual. Representa decisiones y repeticiones mediante los nodos soportados.
5. Revisa el contrato y las conexiones con la lista de comprobación final.
6. Cuando tengas los datos necesarios, entrega únicamente el documento JSON válido, sin comentarios, sin bloques Markdown ni texto adicional. Si puedes crear archivos, guárdalo como `flujo.rpa.json`.

Si la necesidad no se puede resolver con las acciones disponibles, explica qué capacidad falta y pide una alternativa; no generes un flujo que aparente implementarla. No ejecutes ni publiques el flujo como parte de esta tarea.

## Estructura del documento

El objeto raíz tiene exactamente `kind`, `schemaVersion` y `workflow`.
`workflow` contiene `id`, `name`, `nodes`, `connections`, `settings` y `variables`.

- `kind`: `"rpa.workflow"`.
- `schemaVersion`: `"2.0.0"`.
- `workflow.id`: identificador no vacío, de hasta 200 caracteres.
- `workflow.name`: nombre de 1 a 250 caracteres.
- `nodes`: entre 1 y 1000 nodos.
- `settings`: `{ "executionOrder": "fifo", "maxNodeExecutions": 1000 }`. El límite debe ser entero entre 1 y 100000.
- `variables`: objeto con valores JSON iniciales. Usa `{}` si no hay variables.

No agregues propiedades fuera del contrato: no hay campos `edges`, `steps`, `credentials`, `retry` ni `timeout` por nodo. No entregues un workflow n8n ni uses expresiones n8n.

## Nodos admitidos

Cada nodo requiere `id`, `name`, `type`, `typeVersion: 1`, `position: [x, y]` y `parameters`.
Los IDs y los nombres deben ser únicos, no vacíos y de hasta 200 caracteres. Usa IDs sencillos como `abrir_web` para poder referenciarlos. Las posiciones son dos números; distribuye los pasos de izquierda a derecha.

| type | parameters | Salidas de main |
| --- | --- | --- |
| `rpa.manualTrigger` | `{}` | 0: continuar |
| `rpa.action` | `{ "actionId": "…", "input": {} }` | 0: resultado |
| `rpa.set` | `{ "values": { "nombre": "valor" } }` | 0: continuar |
| `rpa.if` | `{ "condition": EXPRESION }` | 0: verdadero; 1: falso |
| `rpa.while` | `{ "condition": EXPRESION, "maxIterations": 100 }` | 0: cuerpo; 1: terminado |
| `rpa.forEach` | `{ "items": { "$ref": "input.items" }, "itemVar": "item", "indexVar": "index", "maxIterations": 100 }` | 0: elemento; 1: terminado |
| `rpa.noOp` | `{}` | 0: continuar |
| `rpa.end` | `{}` | ninguna |

`maxIterations` es un entero entre 1 y 10000. En `rpa.forEach`, `indexVar` es opcional.

Opcionales por nodo: `notes` (texto), `disabled` (booleano), `sensitiveOutput` (booleano) y `onError` (`"stopWorkflow"` o `"continueRegularOutput"`). Prefiere detener el flujo ante errores. `sensitiveOutput: true` oculta salida y capturas en la evidencia persistida; los datos siguen disponibles durante la ejecución. No incrustes contraseñas ni tokens en el JSON; solicita que se suministren por las entradas de ejecución que correspondan.

## Conexiones y bucles

Las claves de `connections` son los NOMBRES de los nodos de origen. Cada destino también usa el NOMBRE del nodo, no su ID. Todos los destinos llevan `type: "main"` e `index: 0` (puerto de entrada). El índice en el arreglo exterior `main` selecciona el puerto de salida.

Ejemplo de conexiones de una condición (fragmento; requiere que existan esos nodos):

```json
{
  "Inicio": { "main": [[{ "node": "¿Continuar?", "type": "main", "index": 0 }]] },
  "¿Continuar?": {
    "main": [
      [{ "node": "Procesar", "type": "main", "index": 0 }],
      [{ "node": "Fin", "type": "main", "index": 0 }]
    ]
  },
  "Procesar": { "main": [[{ "node": "Fin", "type": "main", "index": 0 }]] }
}
```

Para usar solo la salida 1, conserva la salida 0 como arreglo vacío: `"main": [[], [{ "node": "Fin", "type": "main", "index": 0 }]]`.

En un bucle conecta la salida 0 al cuerpo, el último paso del cuerpo de vuelta al nodo de bucle y la salida 1 al siguiente paso o al fin. Usa un único camino de retorno por iteración. Un `while` debe actualizar en su cuerpo los datos que permiten terminar su condición. No crees ciclos sin `rpa.while` o `rpa.forEach` ni conexiones hacia el inicio. Omite conexiones salientes de `rpa.end`.

El motor es secuencial FIFO. Si una salida tiene varios destinos, se encolan en el orden del arreglo. Una convergencia ejecuta el destino una vez por llegada: no sincroniza ramas. Un nodo deshabilitado deja pasar los datos por su salida 0. No hay reintentos automáticos de acciones de escritorio.

## Valores, referencias y condiciones

Los parámetros admiten valores JSON y referencias tipadas con un objeto que contenga únicamente `$ref`:

- `{ "$ref": "input.url" }`: dato suministrado al ejecutar el flujo.
- `{ "$ref": "vars.item" }`: variable compartida de esta ejecución.
- `{ "$ref": "nodeOutputs.abrir_web.tabId" }`: salida del nodo cuyo ID es `abrir_web`, siempre que esa salida realmente tenga el campo `tabId`.
- `{ "$ref": "last.campo" }`: campo de la última salida.
- `{ "$ref": "json.campo" }`: campo de los datos recibidos desde el nodo de origen.

Cada referencia necesita al menos un segmento después de la raíz. Usa letras ASCII, números, guiones o guiones bajos por segmento; nunca `__proto__`, `prototype` ni `constructor`. No uses esas claves en ningún objeto del documento. No referencies nodos que todavía no se hayan ejecutado.

Para insertar valores en texto se admite `"Hola {{vars.nombre}}"`. Para conservar números, booleanos, objetos o listas, usa `$ref`. No se evalúa JavaScript en las referencias ni en las condiciones.

Formas exactas de las condiciones:

- Comparaciones: `{ "op": "eq", "left": { "$ref": "vars.estado" }, "right": "listo" }`. Operadores: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`.
- Booleanos: `{ "op": "truthy", "value": { "$ref": "input.confirmado" } }` o `falsy`.
- Composición: `{ "op": "and", "args": [EXPRESION, EXPRESION] }` o `or`, con al menos una expresión.
- Negación: `{ "op": "not", "arg": EXPRESION }`.

`EXPRESION` es una notación explicativa: reemplázala por un objeto de condición válido.

## Catálogo de acciones del editor

{{ACTION_CATALOG}}

Este catálogo refleja los IDs configurados en Ajustes al copiar o descargar esta guía. No es una consulta de capacidades del robot. Los objetos de entrada sugeridos son plantillas de campos del editor, no esquemas completos: reemplaza los valores vacíos y confirma los parámetros de la acción antes de generar el flujo. No uses `pid: 0` o `windowId: 0` como objetivos reales. Si una acción no tiene plantilla, `{}` no garantiza que no requiera parámetros.

Con acceso al repositorio, consulta `robot/src/automation/actions/` y `robot/src/automation/apps/` para comprobar entradas y salidas. El contrato está en `packages/contracts/src/workflow.ts` y su JSON Schema en `packages/contracts/schemas/workflow-v2.schema.json`. Sin acceso a esa información, pide la definición de la acción que necesites.

Para navegador, `playwright.browser.openTab` admite `url`; `playwright.page.type` usa `selector`, `text` y opcionalmente `clearFirst`; `playwright.page.screenshot` admite `path`, `selector`, `fullPage` y `tabId`. Las acciones de navegador requieren la integración Playwright conectada. Los selectores y rutas deben corresponder al entorno real del robot.

Para CUA, `cua.app.launch` admite `application` y, opcionalmente, `urls` separados por coma. `cua.windows.waitFor` espera una ventana por `application`, `pid` o `titleContains`; su resultado incluye `window.pid` y `window.window_id`, que se pueden referenciar en acciones siguientes. `cua.window.verify` espera un predicado con `predicate` (`windowExists`, `elementExists`, `elementValue`, `elementEnabled` o `elementSelected`), y cuando corresponde `labelContains`, `role`, `expectedValue` o `expectedState`; el timeout máximo es 10 segundos. Solo un resultado `satisfied` cuenta como éxito. `cua.window.visualRegions` analiza una captura reciente y necesita la extensión opcional local de percepción instalada; no ejecuta clics. El driver validado actúa sobre la pantalla principal y no expone selección de monitores.

## Ejemplo completo e importable

Necesidad: «Abre https://example.com y guarda una captura de la página completa en ./artifacts/ejemplo.png». Este ejemplo necesita las acciones de apertura y captura disponibles en el robot.

```json
{
  "kind": "rpa.workflow",
  "schemaVersion": "2.0.0",
  "workflow": {
    "id": "capturar_web",
    "name": "Capturar una página web",
    "nodes": [
      {
        "id": "inicio",
        "name": "Inicio",
        "type": "rpa.manualTrigger",
        "typeVersion": 1,
        "position": [80, 160],
        "parameters": {}
      },
      {
        "id": "abrir_web",
        "name": "Abrir página",
        "type": "rpa.action",
        "typeVersion": 1,
        "position": [360, 160],
        "parameters": {
          "actionId": "playwright.browser.openTab",
          "input": { "url": "https://example.com" }
        }
      },
      {
        "id": "captura",
        "name": "Guardar captura",
        "type": "rpa.action",
        "typeVersion": 1,
        "position": [640, 160],
        "parameters": {
          "actionId": "playwright.page.screenshot",
          "input": { "path": "./artifacts/ejemplo.png", "fullPage": true }
        }
      },
      {
        "id": "fin",
        "name": "Fin",
        "type": "rpa.end",
        "typeVersion": 1,
        "position": [920, 160],
        "parameters": {}
      }
    ],
    "connections": {
      "Inicio": { "main": [[{ "node": "Abrir página", "type": "main", "index": 0 }]] },
      "Abrir página": { "main": [[{ "node": "Guardar captura", "type": "main", "index": 0 }]] },
      "Guardar captura": { "main": [[{ "node": "Fin", "type": "main", "index": 0 }]] }
    },
    "settings": { "executionOrder": "fifo", "maxNodeExecutions": 1000 },
    "variables": {}
  }
}
```

## Comprobación antes de entregar

- El documento se puede analizar como JSON y usa exactamente la versión 2.0.0 y propiedades admitidas.
- Existe exactamente un inicio manual habilitado; todos los nodos son alcanzables desde él.
- No se repiten IDs ni nombres; las conexiones usan nombres existentes y puertos válidos.
- Las dos ramas de cada decisión reflejan lo solicitado; los bucles tienen límites y un retorno correcto.
- Las acciones, entradas y campos de salida están confirmados; no quedan valores inventados ni marcadores pendientes.
- Las referencias usan raíces admitidas y datos disponibles en ese punto de la ejecución.
- El flujo cumple el objetivo y termina con los límites establecidos.

Si tienes el repositorio y dependencias preparadas, valida con `validateFlowDocument(documento, { knownActionIds: new Set(idsPermitidos) })` de `@rpa/contracts`. El JSON Schema comprueba estructura; `validateFlowDocument` también comprueba el grafo. La validación del documento no garantiza que los parámetros funcionen en una aplicación real.

## Cómo usar esta guía

1. Guarda este contenido como `AGENTS.md` en la carpeta donde trabajará tu agente, o adjúntalo a la conversación.
2. Describe tu necesidad y aporta el entorno, los datos, las condiciones y el resultado esperado. Por ejemplo: «Siguiendo AGENTS.md, genera flujo.rpa.json para abrir https://example.com y guardar una captura completa en ./artifacts/ejemplo.png. El robot tiene Playwright conectado».
3. Importa `flujo.rpa.json` con el botón Importar del creador de flujos, o pega el contenido en JSON y pulsa Aplicar JSON.
4. Revisa los pasos en el editor y guarda para validar el documento y crear un borrador. Prueba el flujo en el entorno correspondiente antes de publicarlo para su uso.

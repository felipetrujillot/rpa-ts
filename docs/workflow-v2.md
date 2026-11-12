# Workflows v2 y contratos compartidos

El único formato ejecutable es `rpa.workflow`, `schemaVersion: "2.0.0"`. No hay lector, conversor ni motor del formato anterior. El paquete privado del workspace `@rpa/contracts` es la fuente de tipos y validadores para Electron, preload, interfaz, servidor y diseñador.

## Contratos

- `workflow.ts`: documento, nodos, parámetros, puertos, ejecución, comandos durables y versiones.
- `validation.ts`: validación estructural y de grafo, referencias, JSON Schema, serialización canónica y checksum SHA-256. El servidor y el robot ejecutan la misma función.
- `diagram.ts`: conversión reversible entre el documento y nodos/aristas del diseñador, independiente de Vue.
- `interchange.ts`: intercambio estructural con n8n, con traducciones explícitas de los tipos soportados.
- `protocol.ts`: mensajes WebSocket del agente y servidor, confirmaciones, reservas, resultados y capturas. Todos llevan `protocolVersion: 2`.
- `ipc.ts`: canales y API entre renderer, preload y proceso principal. El subpath `@rpa/contracts/ipc` permite empaquetar los canales sin cargar los validadores completos en preload.
- `automation.ts` y `agent.ts`: catálogo/entradas/resultados de acciones, vinculación, estados y DTOs de operaciones del agente. Los endpoints de vinculación, cola, ejecución y cancelación usan sus esquemas de entrada compartidos.

El paquete se compila antes de ejecutar las comprobaciones de los proyectos. `npm run build --workspace=@rpa/contracts` emite JavaScript, declaraciones TypeScript y [workflow-v2.schema.json](../packages/contracts/schemas/workflow-v2.schema.json). Las compilaciones de Electron incluyen los contratos del workspace, sin depender de rutas del repositorio en el equipo del usuario.

El JSON Schema v2 valida la estructura genérica del nodo `rpa.action`; los IDs y campos de entrada CUA se describen en el catálogo compartido de `packages/contracts/src/cua.ts`, que usan tanto el robot como el editor. Las acciones de navegador mantienen sus definiciones en `robot/src/automation/actions/`. Añadir acciones CUA actualiza el catálogo sin cambiar `schemaVersion: "2.0.0"` ni el JSON Schema de workflows.

## Documento

```json
{
  "kind": "rpa.workflow",
  "schemaVersion": "2.0.0",
  "workflow": {
    "id": "list-apps",
    "name": "Listar aplicaciones",
    "nodes": [
      {
        "id": "start",
        "name": "Inicio",
        "type": "rpa.manualTrigger",
        "typeVersion": 1,
        "parameters": {},
        "position": [80, 160]
      },
      {
        "id": "apps",
        "name": "Aplicaciones",
        "type": "rpa.action",
        "typeVersion": 1,
        "parameters": { "actionId": "cua.apps.list", "input": {} },
        "position": [400, 160]
      }
    ],
    "connections": {
      "Inicio": {
        "main": [[{ "node": "Aplicaciones", "type": "main", "index": 0 }]]
      }
    },
    "settings": { "executionOrder": "fifo", "maxNodeExecutions": 1000 },
    "variables": {}
  }
}
```

Como en n8n, cada conexión se indexa por **nombre del nodo de origen**, tipo de conexión (`main`) e índice de salida; cada destino indica nombre, tipo e índice de entrada. El ID permanece estable al renombrar y se utiliza en trazas y resultados. Los nombres y los IDs deben ser únicos. El diseñador reescribe las conexiones al renombrar y conserva posiciones, notas, nodos deshabilitados, parámetros y ajustes al alternar con JSON.

`typeVersion` versiona la implementación de un tipo de nodo; es independiente de `schemaVersion`. Los tipos iniciales tienen `typeVersion: 1`. Una versión de nodo desconocida se rechaza, y una nueva versión de documento necesita una actualización explícita del contrato.

## Tipos de nodo y ejecución

| Tipo                | Parámetros                                      | Salidas                   |
| ------------------- | ----------------------------------------------- | ------------------------- |
| `rpa.manualTrigger` | Ninguno                                         | 0: continuar              |
| `rpa.action`        | `actionId`, `input`                             | 0: resultado              |
| `rpa.if`            | `condition`                                     | 0: verdadero; 1: falso    |
| `rpa.set`           | `values`                                        | 0: continuar              |
| `rpa.while`         | `condition`, `maxIterations`                    | 0: cuerpo; 1: terminado   |
| `rpa.forEach`       | `items`, `itemVar`, `indexVar`, `maxIterations` | 0: elemento; 1: terminado |
| `rpa.noOp`          | Ninguno                                         | 0: continuar              |
| `rpa.end`           | Ninguno                                         | Ninguna                   |

Hay exactamente un inicio manual habilitado y una entrada `main:0` por nodo ejecutable. La [programación por agente](programacion-flujos.md) permite iniciar este mismo workflow por horario desde el orquestador; no agrega otro nodo de inicio. Los disparadores webhook todavía no tienen implementación. Los ciclos requieren un nodo de bucle acotado; conectar el último nodo del cuerpo de vuelta al bucle permite la siguiente iteración. También hay un máximo global de ejecuciones de nodos. Las conexiones con puertos inexistentes, nodos faltantes, duplicados o nodos inaccesibles se rechazan.

La ejecución es secuencial, con cola FIFO y fan-out en el orden de las conexiones. Cada rama recibe el JSON de su origen. Una convergencia ejecuta el destino una vez por llegada: **no es un join ni una barrera de sincronización**. Los bucles deben tener un único camino de retorno por iteración; no combinar retornos múltiples si se busca una sola iteración. Las variables se comparten dentro de la ejecución y no entre ejecuciones. No hay reintentos automáticos de acciones de escritorio.

`sensitiveOutput: true` excluye la salida y capturas del nodo de la evidencia persistida; no modifica los datos con los que continúa el motor. El diseñador incluye esta opción. Ver [persistencia operativa](persistencia-operativa.md).

Los nodos deshabilitados pasan los datos por la salida 0. El inicio no se puede deshabilitar. `onError` admite `stopWorkflow` o `continueRegularOutput`: este último conserva el error en la traza y continúa por la salida 0. Los errores CUA con efecto incierto siempre detienen la ejecución y requieren revisión. No se aceptan políticas sin implementación, como timeouts o retry configurables por nodo.

Los valores admiten JSON, referencias tipadas como `{ "$ref": "input.text" }` e interpolación de cadenas `{{vars.item}}`. Las raíces son `input`, `vars`, `nodeOutputs`, `last` y `json`; `nodeOutputs` se indexa por ID del nodo y `json` contiene los datos recibidos del origen. No se evalúa JavaScript ni expresiones n8n. Las condiciones admiten comparaciones, `and`, `or`, `not`, `truthy` y `falsy`.

El resultado contiene `nodeRuns` y `outputs: { vars, nodeOutputs, last }`. Cada traza identifica ID, nombre, tipo, puerto elegido, tiempos, salida y error. El motor conserva cancelación real y el protocolo de reserva, diario y confirmaciones descrito en [ejecución confiable](cua-ejecucion-confiable.md).

## Diseñador e intercambio n8n

El diseñador utiliza Vue Flow, controles de zoom, minimapa, puertos y panel de parámetros. La representación del lienzo se obtiene del contrato compartido; no hay una segunda definición de workflow en el componente.

Se tomaron como referencia las [interfaces de workflow de n8n](https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/interfaces.ts) y el [editor Vue de n8n](https://github.com/n8n-io/n8n/tree/master/packages/frontend/editor-ui). Se utiliza Vue Flow directamente, sin incorporar el motor ni copiar el editor completo de n8n.

La página de creación permite importar JSON RPA/n8n y exportar RPA o estructura n8n. El adaptador traduce `n8n-nodes-base.manualTrigger` y `n8n-nodes-base.noOp` en su versión de tipo 1; los nodos `rpa.*` se conservan. La extensión `meta.rpa` conserva versión del schema, variables y límite de ejecución. Los tipos n8n sin implementación, otras versiones de nodo, parámetros o ajustes desconocidos se rechazan explícitamente. No se descartan silenciosamente credenciales ni políticas de ejecución.

Un archivo exportado conserva la estructura de nodos/conexiones para intercambio, pero las acciones `rpa.*` necesitan un paquete de nodos correspondiente para ejecutarse dentro de n8n. Ese paquete no forma parte de esta implementación. Tampoco se soportan aún todos los nodos o el lenguaje de expresiones de n8n.

## Cambio de entorno de desarrollo

Actualizar servidor y robots juntos, con trabajadores detenidos, y aplicar `0007_workflow_nodes_v2.sql` mediante el procedimiento de migración del entorno. La migración archiva versiones anteriores, retira su publicación, termina las ejecuciones pendientes del cambio de protocolo y cambia la tabla de trazas a `node_runs`. Las reservas ocupadas quedan marcadas para revisión: no se liberan por asumir que el robot se detuvo.

Los workflows deben recrearse o importarse en formato v2. Los diarios locales de otro protocolo se rechazan; revisar sus efectos antes de retirar o archivar ese diario y usar un perfil nuevo de desarrollo. No hay conversión automática de documentos ni de comandos pendientes. Las migraciones históricas se mantienen para poder crear una base desde cero; no constituyen soporte ejecutable del formato anterior.

Esta implementación prueba las migraciones sobre MariaDB desechable en Docker. No aplica cambios a la base de desarrollo.

```sh
npm run typecheck
npm run test:contracts
npm test
npm run test:integration
RPA_BROWSER_CHANNEL=chrome npm run test:browser --workspace=@rpa/robot
npm run test:desktop --workspace=@rpa/robot
npm run build --workspaces
```

Las pruebas de escritorio operan aplicaciones reales en el equipo; la suite normal no controla el escritorio. Los fixtures de Calculadora y TextEdit ya son documentos v2.

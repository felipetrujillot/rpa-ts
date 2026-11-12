# Plan del plugin de Microsoft Word

Estado: implementación experimental. Fecha: 2026-11-03.

Implementados catálogo compartido, adaptadores macOS/Windows, sesiones, Canvas,
requisitos versionados e inventario persistente. El usuario autorizó aplazar las
pruebas Windows por no disponer de equipo. El circuito real macOS se completó con
Word 16.30; el ajuste posterior del puente de archivos, la suite negativa y el
paquete instalado siguen pendientes de validación real. El MVP multiplataforma
no se declara listo. Detalles y evidencia: [implementación Word](plugin-microsoft-word.md).

## Objetivo y alcance

Permitir construir en Canvas un flujo que abra una copia de una plantilla DOCX,
complete su contenido, guarde un documento y exporte un PDF mediante Microsoft Word.
El plugin debe servir como primera implementación de un contrato reutilizable para
PowerPoint y otras aplicaciones.

Plataformas requeridas por el usuario: Word de escritorio en macOS y Windows desde
la primera entrega. Implementar dos adaptadores bajo el mismo contrato y registrar
las versiones de Word probadas en cada sistema. El MVP debe superar su circuito
completo en ambos; una plataforma no sustituye la validación de la otra.

La primera entrega incluirá plugins propios empaquetados con el robot. La instalación
dinámica de terceros, el marketplace, Word web, colaboración y ejecución de macros
arbitrarias quedan para fases posteriores. El plugin RPA no implica necesariamente
instalar un complemento dentro de Word: eso depende del adaptador seleccionado.

## Base existente y cambios necesarios

- `robot/src/automation/core/registry.ts` ya registra aplicaciones y acciones.
- `robot/src/automation/core/types.ts` define `AutomationApp` y `AutomationAction`.
- `packages/contracts/src/automation.ts` describe entradas simples y resultados.
  Ampliar sus entradas para objetos/listas JSON y validación por acción.
- `orquestador/layers/admin/app/utils/workflow-editor.ts` contiene parte del catálogo
  de forma manual. Introducir un proveedor de catálogos y formularios declarativos.
- Los nodos `rpa.action` admiten nuevos identificadores. Mantener ese tipo de nodo.
- `packages/contracts/src/protocol.ts` todavía no declara un inventario de plugins.
  Diseñar su transporte y persistencia, incluyendo estado desconocido/desactualizado.
- El motor y el ejecutor remoto contienen tratamiento específico de errores CUA.
  Generalizar la clasificación de efectos inciertos antes de habilitar escrituras Word.
- Existen cambios locales de scripts y editor: integrarse con ellos sin sobrescribirlos.

## Fase 1 — Validar el adaptador de Word

1. Registrar versiones de macOS, Windows y Word y modalidad de ejecución requerida:
   sesión de escritorio iniciada, documentos locales y operación atendida/desatendida.
   Disponer de un entorno de pruebas con Word instalado para cada sistema.
2. Crear una prueba técnica con un DOCX desechable: abrir, localizar un marcador,
   reemplazarlo, guardar una copia, exportar PDF y cerrar el documento de prueba.
3. En macOS, evaluar primero automatización nativa de Word mediante su diccionario
   de scripting, comprobando cobertura real y permisos en la instalación objetivo.
   No asumir paridad con Windows ni soporte de todas las operaciones.
4. Evaluar Office.js si la vía nativa no cubre el alcance. Esta alternativa requiere
   un complemento de Word y un puente autenticado con el robot; comprobar activación,
   ciclo de vida, acceso a archivos y exportación antes de elegirla.
5. Para Windows, evaluar un adaptador externo basado en COM. No ejecutar
   automatización nativa dentro del proceso principal. Ejecutar el mismo circuito
   de prueba y definir una matriz de capacidades macOS/Windows antes de cerrar el SDK.
6. Comprobar Word ausente, acceso denegado, documento protegido, diálogo modal,
   documento ya abierto y cierre inesperado durante una escritura.

Entregable: decisión de arquitectura para ambos adaptadores con evidencia,
limitaciones y capacidades por versión. Si una plataforma no cubre el circuito
completo, resolver el bloqueo o acordar explícitamente un cambio de alcance antes
de declarar listo el MVP. CUA no será un reemplazo automático tras un fallo.

## Fase 2 — Contrato mínimo extensible

1. Añadir manifiesto de plugin: `id`, versión del paquete, versión del SDK,
   nombre, descripción, plataformas y catálogo serializable de acciones.
2. Definir por acción: ID estable, versión de contrato, esquema de entrada/salida,
   campos de formulario, valores iniciales y clasificación de sus efectos.
3. Separar la definición disponible para diseñar del estado de ejecución reportado
   por cada robot: instalado, compatible, permisos pendientes o no disponible.
4. Extender `AutomationRegistry` para registrar el plugin de forma atómica:
   validar IDs, versiones y esquemas antes de modificar el registro.
5. Mantener separados el manifiesto declarativo y el código ejecutor. El navegador
   recibe metadatos, sin cargar ejecutores nativos ni código arbitrario del plugin.
6. Definir requisitos de plugin/acción de cada versión publicada del flujo.
   Su persistencia debe ser explícita: extensión versionada del contrato o metadatos
   de publicación validados. No añadir campos a los esquemas estrictos actuales sin
   actualizar validadores, intercambio, checksum y consumidores correspondientes.

Entregable: catálogo Word compartido entre robot y editor, con validación de entradas
y rechazo de versiones incompatibles antes de producir efectos.

## Fase 3 — Ejecutor y sesiones

1. Definir una interfaz `WordAdapter` independiente del mecanismo nativo.
   Implementar adaptadores macOS y Windows con la misma semántica de acciones,
   errores y resultados. Las diferencias deben expresarse como capacidades explícitas.
2. Ejecutar el adaptador en un proceso auxiliar con mensajes estructurados,
   IDs de solicitud y límites de tiempo. No interpolar entradas en código o comandos.
3. Emitir un `documentId` opaco ligado a la ejecución y al documento concreto.
   No depender del documento activo ni reutilizar esos IDs después de reiniciar.
4. Serializar operaciones sobre la misma sesión de Word y rechazar documentos
   pertenecientes a otra ejecución. Detectar conflictos con documentos del usuario.
5. Propagar cancelación. Detener el proceso auxiliar no prueba que Word haya
   detenido una operación: marcar el resultado incierto y exigir reconciliación.
6. Aplicar errores estructurados y genéricos de efecto incierto en motor, ejecutor
   remoto y trazas. Un efecto incierto debe detener el flujo incluso con
   `continueRegularOutput`; no reintentar automáticamente una modificación.
7. Cerrar únicamente documentos administrados por la ejecución. No terminar Word
   ni descartar documentos ajenos. Registrar limpieza incompleta.

Entregable: sesión identificable, cancelable y con errores diferenciados entre
operación rechazada, operación fallida sin efectos y operación con efectos inciertos.

## Fase 4 — Acciones iniciales de Word

Implementar incrementalmente, según la cobertura demostrada en la fase 1:

- `word.document.open`: abrir un DOCX, opcionalmente sobre una copia de trabajo.
- `word.document.readText`: leer el cuerpo principal del documento.
- `word.document.replaceText`: reemplazo literal con número de coincidencias.
- `word.document.appendText`: añadir texto al cuerpo principal.
- `word.document.fillTemplate`: completar marcadores declarados con datos JSON.
- `word.document.saveAs`: guardar DOCX en una ruta de salida explícita.
- `word.document.exportPdf`: exportar a una ruta PDF explícita.
- `word.document.close`: cerrar con política explícita sobre cambios pendientes.

Precisar por acción el tratamiento de marcadores inexistentes, coincidencias
múltiples, formato del texto, archivos existentes y documentos de solo lectura.
La búsqueda inicial será literal; encabezados, pies, cuadros de texto, tablas complejas,
imágenes y controles de contenido ampliados tendrán capacidades separadas.

Las salidas incluirán `documentId`, recuentos y metadatos de archivo cuando corresponda.
Las rutas pertenecen al equipo del robot: el primer alcance no incluye transferencia
al servidor. No inventar un `artifactId` remoto sin implementar almacenamiento y descarga.
Preservar el archivo de origen y rechazar sobrescrituras salvo configuración explícita.

Entregable: flujo de plantilla a DOCX/PDF con acciones individuales reutilizables.

## Fase 5 — Integración con Canvas y orquestador

1. Incorporar el catálogo declarativo de Word al proveedor de acciones del editor.
2. Mostrar categoría, icono, etiquetas, ayuda y formularios derivados del manifiesto.
3. Admitir rutas del robot, objetos de plantilla y referencias a salidas anteriores.
4. Comunicar y persistir el inventario de plugins por robot dentro de su empresa.
   Registrar versión, capacidades, disponibilidad y fecha de actualización.
5. Permitir diseñar sin conexión. Mostrar disponibilidad desconocida cuando el
   inventario esté desactualizado y volver a comprobarla en el robot al ejecutar.
6. Validar requisitos al publicar/asignar y antes del primer efecto del flujo.
7. Actualizar la guía de agentes desde el mismo catálogo y conservar referencias
   del motor. Verificar que las claves de salida de Word sean accesibles sin ambigüedad.

Entregable: crear y configurar el circuito completo desde Canvas sin editar JSON.

## Fase 6 — Verificación y entrega

- Contratos/registro: IDs duplicados, esquemas inválidos, entradas anidadas,
  versiones incompatibles y disponibilidad por robot.
- Ejecutor: documentos múltiples, aislamiento entre ejecuciones, cancelación,
  timeout, proceso caído y propagación de efectos inciertos hasta la reconciliación.
- Word real, en suite optativa: texto con tildes, saltos de línea y caracteres de
  scripting; marcadores múltiples/ausentes, documento protegido y ruta ocupada.
  Ejecutar la suite contra ambos adaptadores con los mismos fixtures. Incluir rutas
  con espacios, Unicode y convenciones propias de cada sistema.
- Circuito real: copiar plantilla, completar, guardar DOCX, exportar PDF y cerrar.
  Reabrir el DOCX y verificar contenido, origen intacto y PDF legible con texto esperado.
- Editor: formularios y referencias, catálogo sin conexión e inventario incompatible.
- Regresión: typecheck, pruebas de contratos, suite del robot, pruebas del editor
  y build de los workspaces afectados. Integración con BD si cambia persistencia.
- Distribución: probar el auxiliar incluido en el paquete Electron y documentar
  instalación, permisos, versiones verificadas y recuperación tras interrupciones.

El MVP estará listo cuando el circuito real funcione desde Canvas en macOS y Windows,
con versiones de Word documentadas, los fallos sean explícitos y no haya regresiones
en acciones existentes. Las pruebas con mocks no sustituyen esta comprobación.

## Orden de ejecución y ampliaciones

Dependencias: fase 1 → contrato de fase 2 → ejecutor/acciones de fases 3–4 → integración
de fase 5 → validación final de fase 6. Añadir pruebas relevantes en cada fase.

El primer hito verificable será exclusivamente la prueba técnica de abrir,
reemplazar, guardar y exportar en macOS y Windows. Después se cerrará el diseño de los adaptadores y el
desglose de implementación. No fijar fechas antes de resolver esa dependencia.

Tras el MVP: tablas e imágenes, estilos, secciones, encabezados/pies, controles de
contenido y gestión de instalación/actualización de plugins.

## Referencias técnicas

- [Arquitectura y cobertura de Word Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/word/word-add-ins-programming-overview).
- [Modelo de objetos de Word](https://learn.microsoft.com/en-us/office/vba/api/overview/word/object-model).
- [Office para Mac: diferencias y restricciones](https://learn.microsoft.com/en-us/office/vba/api/overview/office-mac).

Estas referencias describen opciones de integración; no prueban por sí solas que
el adaptador elegido cubra las acciones propuestas en la instalación objetivo.

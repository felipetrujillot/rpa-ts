# Plan del plugin de Microsoft Excel

Estado: implementación experimental disponible. Circuito real de macOS verificado;
validación de Windows y aceptación multiplataforma pendientes. Fecha: 2026-11-03.

Implementación, uso, pruebas y limitaciones: [Plugin Microsoft Excel](plugin-microsoft-excel.md).

## Objetivo y alcance

Permitir construir en Canvas un flujo que abra una copia de una plantilla XLSX,
escriba datos y fórmulas, recalcule con Excel, lea resultados y guarde un libro
y un PDF. Microsoft Excel de escritorio en macOS y Windows será requisito desde
la primera entrega, siguiendo la preferencia establecida para los plugins Office.

El MVP operará sobre archivos locales XLSX y sesiones de escritorio iniciadas.
Se documentarán las versiones verificadas de Excel y del sistema operativo.
El primer alcance no incluye Excel web, Google Sheets, coautoría, ejecución como
servicio sin sesión, macros arbitrarias, Power Query, conexiones externas ni XLS/XLSM.
Los gráficos, tablas dinámicas y operaciones estructurales complejas serán ampliaciones.

Se distribuirá como plugin propio empaquetado con el robot. Compartirá el SDK y
catálogo con el [plugin de Word](plugin-microsoft-word-plan.md), sin exigir que Word
esté implementado primero. La edición de archivos sin Excel sería otro adaptador
con capacidades explícitas; no sustituye el recálculo nativo requerido por este MVP.

## Base existente y distribución propuesta

- Reutilizar `AutomationApp`, `AutomationAction` y `AutomationRegistry` del robot.
- Mantener nodos `rpa.action` y el espacio de IDs `excel.*`.
- `packages/contracts/src/automation.ts` ya admite `AutomationValue` anidado:
  aprovecharlo para matrices de celdas y objetos, añadiendo esquemas por acción.
- Sustituir gradualmente las definiciones manuales del editor por un catálogo
  compartido de plugins, formularios y valores iniciales.
- Reutilizar cancelación, diario de ejecución y telemetría existentes, generalizando
  el tratamiento de efectos inciertos que actualmente depende de CUA.
- Respetar los cambios locales existentes en scripts, contratos y editor.

Rutas propuestas; ajustarlas si el SDK compartido ya se implementó al iniciar:

- `packages/contracts/src/plugins.ts`: manifiesto y capacidades comunes.
- `packages/contracts/src/excel.ts`: catálogo y esquemas específicos.
- `robot/src/automation/apps/excel.app.ts`: registro del plugin.
- `robot/src/automation/plugins/excel/`: sesiones, interfaz y adaptadores por sistema.
- `robot/src/automation/__tests__/excel-*.test.ts`: contrato y ejecución simulada.
- `robot/tests/desktop/excel/`: pruebas optativas con Excel real.
- Editor, protocolo y persistencia del orquestador: integración común a Word/Excel.

## Fase 1 — Prueba técnica en ambos sistemas

1. Disponer de macOS y Windows con Excel instalado. Registrar versiones, permisos
   y comportamiento cuando el usuario ya tiene otros libros abiertos.
2. Probar el mismo circuito con una plantilla desechable: abrir copia, escribir
   una matriz, insertar una fórmula, recalcular, comprobar su resultado, guardar
   XLSX, exportar una hoja a PDF y cerrar el libro de prueba.
3. En macOS, evaluar primero automatización nativa mediante el diccionario de
   scripting de Excel; verificar rangos, fórmulas, recálculo y exportación reales.
4. En Windows, evaluar un auxiliar COM fuera del proceso principal de Electron.
5. Evaluar Office.js si una vía nativa no cubre el alcance. Requiere complemento,
   puente autenticado y pruebas de activación, ciclo de vida y acceso a archivos.
   No asumir que una API multiplataforma cubre cualquier versión de Excel.
6. Probar libro protegido, archivo ocupado, diálogo modal, permisos denegados,
   referencias externas y cierre inesperado durante una escritura.

Entregable: decisión de arquitectura para cada adaptador y cobertura demostrada
de todas las acciones iniciales. No declarar listo el MVP con una sola plataforma
validada. No cambiar automáticamente a CUA después de un fallo con posibles efectos.

## Fase 2 — SDK común y semántica de Excel

1. Reutilizar o implementar una sola vez el manifiesto, registro atómico, catálogo,
   versiones, disponibilidad por robot y validación de esquemas propuestos para Word.
2. Separar versión del paquete, versión del SDK y versión del contrato de cada acción.
   Fijar requisitos en cada publicación del flujo y validarlos antes del primer efecto.
   Cualquier extensión del workflow debe actualizar sus esquemas estrictos,
   validadores, checksum, serialización e intercambio.
3. Identificar recursos mediante `workbookId` y `worksheetId` ligados a la ejecución.
   Las acciones de rangos usarán hoja explícita y dirección A1; no selección activa.
   El MVP admitirá rangos rectangulares acotados, con límites de celdas y bytes.
4. Definir matrices rectangulares sin relleno ni transposición implícitos. Diferenciar
   números, texto, booleanos, celda vacía, cadena vacía y error de Excel en la lectura.
   Usar matrices separadas de valores, tipos, fórmulas y errores donde corresponda.
5. Definir fechas con serial y sistema de fechas del libro (1900/1904), o conversión
   explícita desde una fecha ISO. No inferir fechas desde cadenas regionales.
   Preservar identificadores de texto y ceros iniciales; rechazar números no finitos.
6. Separar escritura literal y escritura de fórmulas. `writeValues` debe preservar
   texto que comienza con `=`, `+`, `-` o `@` como texto; validar en Excel real.
   No permitir que datos entrantes activen fórmulas por interpretación implícita.
7. Adoptar fórmulas A1 con nombres de funciones y separadores invariantes en el
   contrato. Cada adaptador debe traducir/verificar su API sin cambiar la semántica.
   Comprobar diferencias entre fórmulas tradicionales y matrices dinámicas;
   estas últimas serán una capacidad posterior salvo cobertura demostrada en ambos.
8. Definir recálculo y frescura del resultado: una lectura debe indicar si el cálculo
   está pendiente. No devolver valores almacenados como si se hubieran recalculado.
   Rechazar operaciones no soportadas y distinguir error de celda de error de ejecución.

Entregable: contrato estable con ejemplos equivalentes en español e inglés y
pruebas comunes para ambos adaptadores.

## Fase 3 — Sesiones, proceso auxiliar y ejecución confiable

1. Crear `ExcelAdapter` con implementaciones macOS/Windows y capacidades declaradas.
2. Usar solicitudes estructuradas con IDs y límites de tiempo. Transportar los datos
   separados del código; no interpolar valores en AppleScript, PowerShell o comandos.
3. Mantener un registro de libros propios por ejecución y verificar identidad antes
   de cada acción. Invalidar referencias al cerrar o reiniciar; serializar operaciones.
4. Abrir una copia de trabajo como opción predeterminada. Detectar conflictos con
   libros abiertos y no adjuntarse silenciosamente a libros con cambios del usuario.
5. Evitar cambios globales en cálculo, eventos o alertas. Si el adaptador necesita
   alguno, registrar su valor anterior y restaurarlo también ante errores; comprobar
   que no afecte otros libros. Preferir una instancia dedicada cuando sea viable.
6. Propagar cancelación y timeout. Si Excel pudo haber aplicado la operación,
   marcar efecto incierto, detener incluso con `continueRegularOutput` y activar
   reconciliación en el ejecutor remoto. No reintentar escrituras automáticamente.
7. No prometer transacciones para acciones de rango. Informar escrituras parciales
   cuando puedan identificarse y operar sobre la copia para limitar efectos.
8. Cerrar solo libros propios con política explícita de guardado. No terminar Excel
   ni descartar cambios ajenos. Verificar limpieza y referencias COM en Windows.
9. No actualizar vínculos externos ni ejecutar automatismos al abrir por defecto.
   Verificar que el adaptador cumple esa política en el entorno objetivo.

Entregable: ejecución identificable y cancelable, con errores que distinguen rechazo,
fallo sin efectos confirmados y operación con efectos inciertos.

## Fase 4 — Acciones iniciales

Implementar y documentar entradas/salidas de estas doce acciones:

- `excel.workbook.open`: abrir XLSX, por defecto sobre copia; devuelve `workbookId`.
- `excel.worksheet.list`: listar hojas, IDs, nombres y visibilidad.
- `excel.worksheet.add`: crear hoja y devolver su ID; rechazar nombres duplicados.
- `excel.range.read`: obtener matrices acotadas de valores, tipos, fórmulas y errores.
- `excel.range.writeValues`: escribir una matriz literal de dimensiones exactas.
- `excel.range.writeFormulas`: escribir una matriz de fórmulas con sintaxis declarada.
- `excel.range.clear`: vaciar contenido de un rango explícito conservando formato.
- `excel.range.format`: aplicar un subconjunto común: formato numérico, negrita,
  relleno y ajuste de ancho; rechazar opciones no soportadas antes de modificar.
- `excel.workbook.calculate`: recalcular el libro administrado y esperar finalización;
  verificar dependencias entre hojas y ausencia de efectos en libros ajenos.
- `excel.workbook.saveAs`: guardar XLSX con destino y sobrescritura explícitos.
- `excel.worksheet.exportPdf`: exportar una hoja con área y ajustes de página explícitos.
- `excel.workbook.close`: cerrar con política explícita sobre cambios pendientes.

El recálculo y la exportación deben pasar la prueba técnica en ambos sistemas antes
de fijar sus garantías. Si el motor solo permite cálculo global, resolver el aislamiento
o explicitar la limitación y acordar su alcance antes de declarar compatibilidad.

Para cada acción definir validación, efectos, límites y tratamiento de hojas ocultas,
protegidas, celdas combinadas y áreas con fórmulas existentes. Rechazar destinos
ambiguos; no expandir rangos ni reemplazar fórmulas fuera del área solicitada.

Las salidas usarán rutas locales y metadatos del equipo del robot. La transferencia
al servidor requiere almacenamiento y descarga propios; no incluir referencias
remotas ficticias. Respetar `sensitiveOutput` para matrices y contenido de libros.

## Fase 5 — Canvas y orquestador

1. Añadir categoría Excel con catálogo y formularios derivados del manifiesto.
2. Ofrecer campos de libro, hoja y rango, entrada de matrices JSON y referencias
   a salidas anteriores. Validar dimensiones antes de enviar al robot.
3. Permitir seleccionar hojas descubiertas cuando exista sesión; conservar IDs o
   referencias del flujo. El diseño sin conexión debe permitir parámetros explícitos.
4. Mostrar esquemas de salida y ejemplos de referencias a matrices y resultados.
   Verificar que el resolvedor actual pueda acceder a índices sin perder tipos.
5. Sincronizar inventario de plugins por robot y empresa, con versión, capacidades,
   permisos y fecha de actualización. Mostrar estado desconocido si está desactualizado.
6. Validar compatibilidad al publicar/asignar y de nuevo en el robot antes de ejecutar.
7. Generar la guía de agentes desde el mismo catálogo que usa Canvas.

Entregable: configurar el circuito del MVP desde Canvas sin editar el documento
JSON del flujo; los datos matriciales pueden introducirse como JSON o referencias.

## Fase 6 — Verificación y entrega

- Contratos: matrices vacías/irregulares, dimensiones, rangos inválidos, límites,
  tipos, versiones incompatibles y registro duplicado sin estado parcial.
- Sesiones: dos libros con nombres iguales, cambio de hoja activa, libro ajeno,
  cancelación, proceso caído y reconciliación por efecto incierto.
- Datos reales: tildes, comillas, saltos, rutas Unicode, ceros iniciales, cero frente
  a vacío, booleanos, texto parecido a fórmula, decimales y fechas 1900/1904.
- Fórmulas: libro en cálculo manual, dependencias entre hojas, resultado conocido,
  errores de celda y recálculo tras cambiar un dato; comprobar español e inglés.
- Integridad: preservar hojas no afectadas, estilos, fórmulas y origen; probar
  rangos protegidos, combinados, conflictos de archivos y límites de tamaño.
- Circuito con Excel real en ambos sistemas: abrir plantilla con precio/cantidad,
  escribir datos, calcular subtotales y total, leer y contrastar resultados con
  cálculo independiente, cambiar un dato y comprobar actualización, guardar y
  reabrir XLSX, exportar PDF y verificar contenido/área de impresión.
- Editor/orquestador: referencias de matrices, catálogo sin conexión, inventario
  incompatible, aislamiento por empresa y conservación de versiones publicadas.
- Regresión: typecheck, contratos, robot, editor y build de workspaces afectados;
  pruebas de integración con BD si se modifica persistencia.
- Distribución: probar los auxiliares empaquetados en Electron en macOS y Windows,
  instalación, permisos, diagnóstico y recuperación tras una interrupción.

Las pruebas de escritorio serán optativas y separadas de la suite normal. Las pruebas
con mocks no acreditan compatibilidad con Excel. El MVP se acepta únicamente con
el circuito completo validado en ambos sistemas, versiones documentadas y sin
alteraciones a libros ajenos ni regresiones en las acciones existentes.

## Hitos y ampliaciones

Orden: prueba técnica en ambos sistemas → SDK y semántica común → sesiones y
acciones → Canvas/inventario → validación real y distribución. Añadir pruebas
relevantes durante cada fase. No fijar fechas antes de resolver los adaptadores.

Primer hito: abrir, escribir, calcular, leer, guardar y exportar una plantilla en
macOS y Windows. Después cerrar la elección de mecanismos y el desglose de tareas.

Tras el MVP: tablas estructuradas, filas/columnas, rangos con nombre, filtros y
ordenación, CSV con tipos explícitos, gráficos, tablas dinámicas, matrices dinámicas,
exportación de libros completos y soporte controlado de XLSM y actualizaciones externas.

## Referencias técnicas

- [Excel Add-ins: arquitectura y plataformas](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-overview).
- [Recálculo y sus ámbitos](https://learn.microsoft.com/en-us/office/vba/api/excel.application.calculate).
- [Formula2 y matrices dinámicas](https://learn.microsoft.com/en-us/office/vba/api/excel.range.formula2).
- [Office para Mac: diferencias y restricciones](https://learn.microsoft.com/en-us/office/vba/api/overview/office-mac).

Las referencias orientan la elección técnica. La cobertura específica de cada
adaptador, versión y acción requiere las pruebas reales descritas en este plan.

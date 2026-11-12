# Plugin Microsoft Excel

Implementación experimental del [plan](plugin-microsoft-excel-plan.md), paquete
`excel` 0.1.0, SDK 1.0.0 y contratos de acciones 1.0.0. Las doce acciones están
registradas en el robot y disponibles en la categoría Excel de Canvas. Excel de
escritorio es obligatorio; no hay sustitución por un editor de archivos ni por CUA.

## Uso en Canvas

1. Añadir **Abrir libro Excel**, indicar una ruta absoluta XLSX y mantener `copy: true`.
2. Añadir **Asignar variables** con `workbookId` de tipo Referencia y valor
   `last.workbookId`. Los pasos siguientes usan `vars.workbookId`.
3. Elegir la hoja mediante su nombre explícito o un ID devuelto por **Listar hojas**.
   Los IDs pertenecen a la sesión; no usar IDs de ejecuciones anteriores.
4. Introducir matrices con el tipo JSON o mediante una referencia a una matriz.
   Indicar un rango A1 con exactamente las mismas dimensiones.
5. Recalcular antes de usar resultados o exportar PDF. Leer un rango devuelve
   `values`, `types`, `formulas`, `errors`, `dateSystem` y `calculationPending`.
6. Guardar XLSX y exportar PDF con rutas absolutas y sobrescritura explícita.
   Cerrar indicando `saveChanges: true` o `false`.

La [plantilla de flujo importable](examples/excel-template.rpa.json) utiliza las hojas
`Datos` y `Resumen` de `robot/tests/desktop/excel/template.xlsx`. Sus entradas son:

```json
{
  "templatePath": "/ruta/absoluta/template.xlsx",
  "values": [[12.5, 4], [3, 2]],
  "xlsxPath": "/ruta/absoluta/resultado.xlsx",
  "pdfPath": "/ruta/absoluta/resumen.pdf"
}
```

El total queda en `vars.total`. Por ejemplo, `last.values.0.0` recupera una celda
conservando su tipo. El resolvedor acepta índices numéricos separados por puntos.
Para contenidos privados, activar **Ocultar salida** (`sensitiveOutput`). Los
archivos de salida permanecen en el equipo del robot; no se transfieren al servidor.

## Contrato de datos y acciones

El catálogo, formularios, valores iniciales, versiones y esquemas JSON se exportan
desde `packages/contracts/src/excel.ts`. La guía de agentes se genera con ese mismo
catálogo. Las entradas se validan al aplicar el nodo, al validar/publicar el flujo
y nuevamente después de resolver referencias en el robot.

- Rango rectangular A1, máximo 10.000 celdas; sin selección activa, rangos completos,
  nombres de rango, selección múltiple ni nombre de hoja dentro de la dirección.
- Matrices rectangulares exactas, sin transposición ni relleno. Entrada y lectura
  de hasta 1 MB; XLSX de hasta 50 MB y contenido ZIP descomprimido de hasta 100 MB.
- `writeValues`: números finitos, booleanos, texto y `null`. `null` vacía contenido;
  `""` escribe texto vacío. El texto `001`, `=1+1`, `+2`, `-3` o `@SUM(A1)` permanece
  literal. Se comprueba la conservación del texto después de escribir cada celda.
- `writeFormulas`: matriz de fórmulas con `syntax: "A1-invariant"`; funciones en
  inglés, comas y referencias A1. Ejemplo equivalente para usuarios en español e
  inglés: `[["=SUM(A1:A2)"]]`. No convertirlo a `SUMA` ni usar punto y coma.
  Se rechazan vínculos externos, DDE, funciones externas, fórmulas matriciales y
  sintaxis dinámica fuera del subconjunto inicial.
- Fechas como números seriales y `dateSystem: "1900" | "1904"`. No se interpreta
  una cadena ISO o regional como fecha: las cadenas se escriben literalmente.
- `read` separa `empty`, `string`, `number`, `boolean` y `error`; un error de celda
  devuelve valor `null` y su texto en `errors`, sin hacer fallar la acción.
- `format`: `numberFormat`, `bold`, `fill: "#RRGGBB"` y `columnWidth` de 1 a 255.
  El ancho afecta las columnas completas del rango, como en Excel.
- Listar incluye hojas ocultas; las operaciones de rango/PDF requieren hojas
  visibles. Escrituras y formato rechazan hojas protegidas y rangos combinados
  o con fórmulas matriciales antes de modificar el contenido.
- Se rechazan destinos existentes si `overwrite` no es `true`, enlaces simbólicos
  de destino, plantillas como destino y libros de igual nombre en una misma sesión.
  XLS, XLSM, macros, conexiones y relaciones externas quedan fuera del alcance.

Las lecturas indican conservadoramente cálculo pendiente después de abrir,
escribir, crear hojas o vaciar rangos. `calculate` ejecuta el motor nativo y elimina
esa marca solo al finalizar. No representa valores almacenados como recalculados.
No editar los libros manualmente mientras se ejecuta el flujo: la marca refleja
las acciones administradas por el plugin y no vigila ediciones externas concurrentes.

## Adaptadores, guardado y ciclo de vida

Cada ejecución mantiene su propia sesión y serializa operaciones. Los auxiliares
se incluyen como fuentes estáticas en el bundle Electron y se materializan en un
directorio temporal con permisos restrictivos. Intercambian JSON por stdin/stdout,
con IDs y tiempos máximos; los datos no se interpolan en código ni comandos.

**macOS:** auxiliar JXA y diccionario nativo de Excel. Las copias se crean dentro
de `~/Library/Containers/com.microsoft.Excel/Data/tmp` para evitar un diálogo
Grant Access por cada archivo temporal. Abrir el original con `copy: false` puede
requerir autorización de archivo en Excel. El permiso de Automatización para Excel
sigue siendo necesario. Se rechazan operaciones si hay libros ajenos abiertos.
El cálculo requiere un solo libro administrado en la instancia, porque el motor
expone recálculo completo global. La exportación copia la hoja a un libro temporal,
aplica la configuración de página en esa copia, exporta solo esa hoja y la cierra.
No altera la configuración de impresión de las hojas originales.

**Windows:** auxiliar PowerShell STA con una instancia COM nueva, nunca adjunta a
la instancia del usuario. Abre sin actualizar vínculos y deshabilita automatismos
al abrir, restaurando las opciones anteriores. También exige un único libro en su
instancia para recalcular. El auxiliar libera referencias COM al cerrar; no mata
Excel. La implementación requiere validación real en Windows antes de aceptarla.

`saveAs` guarda nativamente en una ruta de trabajo nueva y publica el archivo al
destino mediante una copia y promoción en el sistema de archivos. Así no necesita
cambiar `DisplayAlerts` ni responder diálogos de sobrescritura. Devuelve `path`
(destino) y `workingPath` (libro abierto). `close(saveChanges: true)` guarda cambios
posteriores y actualiza el destino, comprobando que nadie haya modificado el
artefacto publicado. `close(false)` conserva el último archivo publicado. Al acabar
el flujo se cierran y descartan las copias propias que sigan abiertas; originales
abiertos con `copy: false` y sesiones inciertas permanecen para revisión.

Un timeout, cancelación después del envío, caída del auxiliar o fallo después de
iniciar una modificación produce `ACTION_EFFECT_UNCERTAIN`. Invalida la sesión,
conserva las copias y detiene el flujo incluso con `continueRegularOutput`. El
ejecutor remoto lo convierte en `EXECUTION_INTERRUPTED`, con reconciliación
obligatoria. No hay reintentos de escritura ni promesas de transacción; los errores
incluyen el número de celdas escritas cuando se conoce. Los rechazos anteriores al
primer efecto permiten corregir entradas sin invalidar la sesión.

Las publicaciones fijan versiones del paquete, SDK y acciones. La asignación y la
admisión remota verifican el inventario de plugins; el robot vuelve a verificarlo
antes del primer efecto del flujo. El inventario viaja en heartbeats autenticados,
se almacena por empresa y robot y caduca a los 30 segundos. `available` diagnostica
instalación/registro; `verified: false` indica que no se ha completado la aceptación
multiplataforma del MVP.

## Verificación y pendientes

Circuito real verificado el 2026-11-03 en **macOS 26.6.2 (25G83), arm64, Excel 16.30**:
las doce acciones, literales incluidos vacío/cero/booleano, tildes/comillas/saltos,
fórmulas invariantes entre hojas, recálculo después de cambiar datos, errores de
celda, XLSX guardado/reabierto, cambios posteriores publicados con cierre y guardado,
PDF con contenido y área correctos, fechas 1904 e
invasión de otra sesión rechazada sin alterar el libro ajeno. Se comprobó el XLSX
original por igualdad de bytes. El contenido del PDF se verificó con `pdftotext`.
Esto no acredita otras versiones, idioma de interfaz español ni Windows.

```sh
npm run test:contracts
npm test --workspace=@rpa/robot
npm run test:integration
npm run typecheck
npm run build --workspace=@rpa/robot
npm run build --workspace=@rpa/orquestador

# Optativo: Excel real, sesión interactiva y ningún libro del usuario abierto en macOS.
RPA_EXCEL_DESKTOP=1 RPA_PDFTOTEXT=/ruta/a/pdftotext npm run test:desktop --workspace=@rpa/robot -- tests/desktop/excel/excel-native.test.ts
```

En PowerShell, establecer `$env:RPA_EXCEL_DESKTOP = '1'` y ejecutar el mismo comando
npm; `RPA_PDFTOTEXT` es optativo, pero obligatorio para comprobar el texto/área del PDF.
Las pruebas normales no abren Excel. Las plantillas se regeneran con Python estándar:
`python3 robot/tests/desktop/excel/create-fixture.py`.

Pendientes para aceptar el MVP del plan: repetir el circuito en Windows con versiones
documentadas; probar ambos idiomas, distribución Electron instalada/firmada y su
permiso de Apple Events; ampliar los casos reales de protección, combinaciones,
archivos ocupados y cancelación/caída durante escritura. En macOS se detecta reinicio
de Excel y cierre de referencias; el diccionario no ofrece una identidad duradera
que permita certificar un cierre y reapertura manual del mismo archivo entre dos
solicitudes. No se declara compatibilidad final mientras queden esas verificaciones.

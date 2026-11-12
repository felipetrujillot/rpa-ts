# Microsoft Word de escritorio

Estado: implementación experimental, 2026-11-03. Windows está implementado pero
pendiente de validación real, aplazada por el usuario al no disponer de ese equipo.
El MVP multiplataforma todavía no está validado.

## Adaptadores y evidencia

| Plataforma | Adaptador | Entorno comprobado | Resultado |
| --- | --- | --- | --- |
| macOS | AppleScript nativo, auxiliar `osascript` con protocolo JSON | macOS 26.6.2, arm64; Word 16.30, build 16.30.19101301 | Prueba técnica y circuito de acciones completados; DOCX reabierto, origen intacto y PDF verificado con extracción independiente de texto |
| Windows | COM externo mediante PowerShell, STA | Sin equipo disponible | Implementado; sin versión de Word certificada |

La prueba técnica dejó evidencia local en
`robot/artifacts/word/Prueba Word ñ ZuV424/report.json`. Las pruebas del plugin
guardan `run.json` y `verification.json` bajo `robot/artifacts/word-plugin/`.
Estos artefactos desechables no se distribuyen ni se suben al servidor.

La automatización nativa cubrió el circuito macOS evaluado. No se necesitó
Office.js ni un complemento dentro de Word. No existe sustitución automática por
CUA. Se requiere una sesión de escritorio iniciada y Word instalado; solo se ha
comprobado operación atendida con archivos locales.

## Archivos y permisos en macOS

Word aplica su propio sandbox. Abrir archivos externos nuevos directamente puede
mostrar **Grant File Access**, aunque el robot tenga acceso a esas rutas. Una
prueba negativa con `copy=false` produjo este diálogo repetidamente y se detuvo.

El plugin utiliza ahora copias privadas en
`~/Library/Containers/com.microsoft.Word/Data/Library/Caches/rpa-automation/`.
Word abre, guarda y exporta dentro de esa carpeta. El robot publica los resultados
en las rutas solicitadas mediante sus permisos de sistema existentes; no concede
permisos adicionales a Word. `copy=false` con un original externo se rechaza antes
de contactar Word con `WORD_FILE_PERMISSION_REQUIRED`. Use `copy=true` (predeterminado).

El cambio del puente de archivos está cubierto por pruebas simuladas y typecheck;
su nueva disposición de carpetas queda pendiente de repetir contra Word real.
No se relanzaron pruebas nativas después del aviso del usuario. Los permisos de
Automatización para controlar Word siguen siendo necesarios y los concede el
usuario al proceso que ejecute el robot. No se cambian permisos ni seguridad del
sistema automáticamente.

## Catálogo y uso en Canvas

El catálogo compartido vive en `packages/contracts/src/word.ts`: manifiesto `word`
0.1.0, SDK 1.0.0, contratos de acciones 1.0.0. El registro valida el manifiesto
antes de registrar ejecutores; el navegador recibe definiciones serializables.

1. **Abrir documento Word**: ruta DOCX absoluta del robot; conservar `documentId`.
2. **Completar plantilla Word**: objeto `data`, por ejemplo
   `{ "cliente": { "nombre": "María" }, "items": [42] }` sustituye
   `{{cliente.nombre}}` y `{{items.0}}`.
3. **Guardar DOCX**: destino explícito `.docx`.
4. **Exportar PDF**: destino explícito `.pdf`.
5. **Cerrar documento Word**: seleccionar `discard`, `save` o `rejectIfDirty`.

Los formularios admiten objetos y referencias a
`nodeOutputs.<ID del nodo de apertura>.documentId`. También hay acciones
individuales `readText`, `replaceText` y `appendText`. `find` es literal incluso
si contiene `{{marcadores}}`; una referencia explícita sigue siendo válida.

La búsqueda distingue mayúsculas, devuelve recuentos y admite todas las
coincidencias o la primera. Los marcadores ausentes fallan antes de escribir,
salvo `missing=ignore`. `null` se convierte en texto vacío. Los cambios operan
sobre rangos del cuerpo principal; no se garantiza el formato del texto nuevo.
Encabezados, pies, cuadros, estilos, imágenes y tablas complejas quedan fuera.

Las salidas de archivos son `{ documentId, path, bytes }`, locales al robot.
Nunca incluyen un `artifactId` remoto. Se preservan los orígenes, incluso ante
alias o enlaces duros. Un destino existente requiere `overwrite=true`. En macOS,
cerrar con `save` actualiza el último DOCX publicado; si alguien lo modificó
desde el último guardado, se rechaza la operación para conservar ese cambio.

## Ejecución, inventario y recuperación

Los IDs son opacos y propios de cada ejecución. Las operaciones están
serializadas; no dependen del documento activo. El auxiliar recibe JSON por
stdin con IDs y límites de tiempo, sin interpolar datos en comandos.

Un timeout, cancelación posterior al envío o caída del auxiliar puede dejar
efectos inciertos en Word. `ACTION_EFFECT_UNCERTAIN` detiene el flujo aun con
`continueRegularOutput`, invalida la sesión y evita reintentos y limpieza que
escriba sobre esos documentos. Detener el auxiliar no detiene Word. Revise los
documentos y archivos conservados antes de ejecutar de nuevo; el robot registra
`WORD_CLEANUP_INCOMPLETE` cuando no pudo limpiar su sesión. Nunca termina Word ni
cierra documentos ajenos.

El inventario viaja por heartbeat, se persiste por empresa/robot y muestra
versiones, capacidades y permisos pendientes. Pasados 30 segundos se considera
desactualizado. Canvas permite diseñar sin conexión; asignación y ejecución
requieren compatibilidad vigente. Los requisitos versionados forman parte del
documento publicado, sus validadores, intercambio y checksum.

## Verificación y distribución

Pruebas sin Word:

```sh
npm run test:contracts
npm test
npm run test:word:probe --workspace=@rpa/robot
npm run typecheck
```

Pruebas optativas que **abren Word**; ejecutarlas solo en un escritorio de prueba:

```sh
npm run test:word --workspace=@rpa/robot
npm run test:word:real --workspace=@rpa/robot
```

Requieren Python 3 y `pdftotext` para los fixtures y la verificación independiente.
En Windows puede establecerse `RPA_WORD_PYTHON` si el ejecutable no es `python`.
La prueba técnica independiente conserva su propio manejo de rutas y puede
solicitar acceso a archivos en macOS; no sustituye la prueba del puente del plugin.

Los scripts auxiliares del plugin se importan como recursos de texto y quedan
incluidos en el bundle Electron; se extraen con permisos privados al ejecutarse.
Se comprobó el build, pero falta ejecutar el instalador empaquetado y verificar
su identidad/permisos de Automatización. En Windows falta comprobar políticas de
PowerShell, COM, conflictos con documentos del usuario, fallos nativos y el
circuito completo con los mismos fixtures. La suite negativa macOS también
queda pendiente tras detenerse por el diálogo de permisos.

Referencias: [Office para Mac y sandbox](https://learn.microsoft.com/en-us/office/vba/api/overview/office-mac),
[solicitudes de acceso a archivos](https://learn.microsoft.com/en-us/office/vba/office-mac/grantaccesstomultiplefiles),
[modelo de objetos Word](https://learn.microsoft.com/en-us/office/vba/api/overview/word/object-model).

# Persistencia operativa y producto SaaS

## Implementado

Los eventos de nodo ya no se fabrican al terminar el flujo. El motor publica `started` antes de la acción y `finished` después, con un `executionIndex` por invocación: un bucle puede ejecutar el mismo nodo varias veces sin sobrescribir su historial. El callback se espera antes de avanzar. Un fallo de almacenamiento impide nuevos efectos; si ocurre después de una acción, la ejecución se considera incierta y requiere revisión.

`packages/contracts/src/telemetry.ts` (exportado desde la raíz de `@rpa/contracts`) define los tipos y validadores compartidos. El robot crea mensajes `run_telemetry` con ID de evento, ejecución, comando y token de reserva. Cada mensaje se escribe mediante temporal, fsync y renombrado en `userData/telemetry-outbox`; solo `telemetry_receipt` permite borrarlo. La notificación IPC inicia el envío durante la ejecución; reconexión y heartbeat lo reintentan. Los lotes de lectura tienen límite de cantidad y tamaño. Puede haber mensajes repetidos o fuera de orden.

El servidor valida identidad, empresa, agente, comando aceptado y token. Mientras está activo exige la reserva correspondiente. Comprueba los nodos contra la copia inmutable del workflow. Guarda cada invocación en `node_runs` y un recibo persistente por evento. Un inicio tardío o un fin repetido no puede revertir ni modificar un nodo finalizado. Los eventos perdidos se pueden completar después del resultado terminal con el mismo comando y token. No se requieren memoria del proceso ni la conexión original para recuperar las trazas.

El resultado terminal se guarda en `flow_runs.output_json`: estado observado, tiempos, salidas, variables y error. Las trazas completas por nodo se guardan por separado, con su salida y error; no se duplican dentro del mensaje terminal. La combinación de ambos constituye el resultado completo de ejecución dentro de los límites admitidos. El estado administrativo del run puede ser `cancelled` aunque la acción terminara antes de recibir la cancelación: el resultado observado conserva esa información.

## Artefactos y acceso

Las capturas PNG/JPEG/WebP se extraen tanto de data URLs como del formato de imágenes CUA `{ data, mimeType }`. Se sustituyen por `{ "$artifact": "UUID" }` antes de guardar el resultado en el diario. El UUID es estable por comando y contenido. Se transmiten como mensajes independientes; el servidor verifica tamaño, firma del formato y SHA-256 antes de persistir. Los reenvíos conservan un solo artefacto central.

La primera implementación usa `run_artifacts` en MariaDB, con contenido base64 en una columna `longtext` y empresa, ejecución, MIME, tamaño y hash separados. No utiliza rutas públicas ni acepta rutas de archivo proporcionadas por el agente. Es un almacenamiento central durable sencillo para desarrollo, no un backend de objetos optimizado para volumen. El límite inicial es **4 MB por imagen** y aproximadamente **6 MB por mensaje**; superar el límite detiene el avance y exige revisión, sin truncar silenciosamente el resultado. Imágenes fragmentadas, streaming de resultados de mayor tamaño y almacenamiento S3 compatible quedan pendientes.

El detalle del flujo del agente incluye un panel que consulta nodos mientras corre la ejecución, pagina sus invocaciones, muestra salidas y permite abrir capturas. La lectura de la captura es explícita y se audita. Las consultas no incluyen las entradas originales del runtime ni cargan binarios en el listado.

API tRPC bajo `agentes`:

- `getFlowRunDetail({ uuid_flow_run, after?, limit? })`: ejecución, nodos paginados y metadatos de hasta 200 artefactos. Los agentes solo pueden consultar sus propias ejecuciones.
- `getRunArtifact({ artifact_id })`: contenido de una captura, solo para usuarios de la misma empresa; registra `artifact.read`.
- `getExecutionMetrics({ days? })`: conteos por estado, duración media, nodos fallidos, cantidad y bytes de artefactos. Ventana de 1 a 90 días para ejecuciones/nodos; artefactos refleja el almacenamiento retenido completo de la empresa.
- `getExecutionAudit({ limit? })`: eventos operativos de auditoría para administradores.
- `getEvidenceRetention`, `setEvidenceRetention({ evidenceDays, auditDays })`, `purgeEvidenceRetention` y `eraseFlowRunEvidence({ uuid_flow_run })`: política y borrado. Cambios y borrado requieren los roles actuales 0/1.

Las métricas son operativas, consultadas desde SQL; no son un medidor de consumo facturable ni sustituyen métricas de infraestructura. La auditoría cubre despacho, resultado terminal, creación/lectura de artefactos, cambios de política y eliminación. No es aún una auditoría de todas las mutaciones del producto ni un registro resistente a administradores de la base de datos.

## Retención y eliminación

Cada empresa puede configurar evidencia entre 1 y 365 días y auditoría entre 30 y 3650 días; los valores predeterminados son 30 y 90 días. La tarea Nitro `retention` se programa cada hora en el proceso Node del orquestador, con hasta 100 ejecuciones por empresa en cada pasada. Puede ejecutarse también mediante la operación administrativa de purga. Un despliegue sin un proceso Node permanente deberá invocar esta tarea desde su planificador.

Se borran nodos, artefactos, recibos y entradas/salidas/error del run, y se vacía el payload de comandos completados. Se conserva la identidad operativa y `telemetry_deleted_at`. Un reenvío tardío recibe confirmación sin recrear evidencia eliminada. La eliminación y su auditoría son transaccionales. Se excluyen ejecuciones activas y reservas pendientes de reconciliación; estas requieren revisión antes de poder eliminarse.

La política central no borra backups ni los diarios de dispositivos desconectados. La bandeja local elimina archivos confirmados; los registros locales de deduplicación todavía no tienen compactación o caducidad automática. Hay que definir esas políticas antes de distribuir el producto.

## Secretos

La telemetría se redacta antes de su escritura en el robot y de nuevo al persistir en el servidor. Se ocultan claves sensibles (contraseña, token, credenciales, cookies, autorización, API keys), valores conocidos encontrados en esos campos del documento/runtime, tokens Bearer y credenciales en URLs. El motor continúa usando los valores originales.

Un nodo con `sensitiveOutput: true` oculta su salida completa y no publica sus capturas. La protección propaga los valores de texto sensibles conocidos a la evidencia posterior. La opción está disponible en el inspector del diseñador.

La redacción automática no reconoce todos los secretos arbitrarios ni modifica píxeles. Una captura puede contener datos sensibles visibles: debe excluirse con `sensitiveOutput` cuando corresponda. Esto no implementa un vault. Los documentos y entradas de ejecución, tanto en base de datos como en el comando admitido del diario local, pueden seguir conteniendo valores sensibles necesarios para ejecutar. Se requieren referencias a credenciales, cifrado y resolución en tiempo de ejecución para completar ese ámbito.

## Migración y validación

Actualizar servidor y robots juntos. La migración `0008_operational_telemetry.sql` incorpora identidad de empresa, invocaciones y estado running a `node_runs`, tablas de artefactos, recibos, auditoría y políticas, y la marca de eliminación. Retira las trazas de desarrollo anteriores sin identidad de empresa. No se aplicó a la base de desarrollo; las pruebas migran una MariaDB desechable.

```sh
npm run typecheck
npm test
npm run test:contracts
npm run test:integration
npm run build --workspaces
```

La integración utiliza los handlers y consultas reales con una base MariaDB temporal. Cubre eventos durante la ejecución, reenvío, orden invertido, token incorrecto, empresa y dispositivo ajenos, integridad y acceso de capturas, redacción, resultado completo, borrado, retención y prevención de resurrección de evidencia. Falta una prueba end-to-end de un robot vinculado con el servidor desplegado y su proxy.

## Distribución y siguientes etapas

`.github/workflows/quality.yml` prepara typecheck, contratos, pruebas y compilación del robot en Windows, macOS y Linux, y pruebas de persistencia sobre MariaDB en Linux. No publica una versión ni usa certificados. La matriz Windows no se ejecutó desde este equipo. Se siguen las acciones oficiales de [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node) y [setup-python](https://github.com/actions/setup-python). Las pruebas gráficas reales de CUA requieren sesiones interactivas y permisos; no se activan en runners hospedados.

Antes de una versión distribuible siguen pendientes:

1. **Credenciales y equipos:** vault/referencias a secretos, invitaciones, miembros y roles granulares por recurso; auditoría de todas las mutaciones relevantes.
2. **Límites de empresa:** cuotas de dispositivos, concurrencia y almacenamiento con reservas transaccionales al admitir el trabajo. Las métricas actuales no hacen cumplir cuotas.
3. **Consumo y facturación:** ledger inmutable e idempotente por ejecución, planes y periodos, proveedor de pagos, webhooks deduplicados y conciliación. Definir antes si se cobra por dispositivo, ejecución o tiempo.
4. **Instaladores:** empaquetar Electron, dependencias nativas, CuaDriver y auxiliares OCR para cada SO/arquitectura; pruebas en máquinas limpias, firma Windows y firma/notarización macOS.
5. **Actualizaciones:** manifiestos firmados, canales de despliegue, comprobación de integridad y salud, conservar versión anterior y rollback con diario/protocolo compatible. Probar interrupción de actualización y prohibir actualizar con efectos nativos activos.
6. **Operación a escala:** backend de objetos y descargas temporales, límites de volumen/fragmentación, compactación local, métricas de infraestructura, pruebas de proxy/desconexión, despliegue multiinstancia y recuperación de backups.

La compilación del robot ejecuta typecheck antes de generar su salida. Una publicación futura deberá depender de todos los jobs de calidad y de las verificaciones de firma e instalación; la configuración actual no equivale a tener instaladores validados ni rollback implementado.

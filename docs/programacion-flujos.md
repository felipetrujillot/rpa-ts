# Programación de flujos por agente

Al asignar un flujo o editar su programación se puede elegir ejecución manual,
cada ciertos minutos u horas, todos los días, de lunes a viernes, días concretos
de la semana, un día del mes o cron avanzado. El formulario muestra el resumen y
las próximas tres fechas antes de guardar. Los meses sin el día elegido se omiten.

La zona horaria es explícita y se guarda por asignación. El valor inicial es
`America/Santiago`; se pueden elegir otras zonas IANA. Las horas locales siguen
los cambios de horario de esa zona. El servidor valida la misma expresión que
el formulario. Se admite cron de **cinco campos**, sin segundos ni macros.
Los intervalos están alineados al reloj: cada 15 minutos significa :00, :15, :30
y :45; cada 4 horas significa 00:00, 04:00, 08:00, etc.

## Ejecución automática

La tarea Nitro `schedules` se ejecuta cada minuto en un proceso Node permanente.
Busca asignaciones activas cuyo `next_scheduled_at` haya vencido. Bloquea la fila
de la asignación, crea una ejecución con `trigger_type: schedule`, registra
`run.scheduled` y adelanta el próximo horario dentro de una sola transacción.
Dos planificadores simultáneos no pueden crear dos ejecuciones para la misma
ocurrencia. El despacho utiliza las reservas, confirmaciones y diario existentes.

- Solo se ejecutan versiones publicadas válidas, dentro de la empresa de la asignación.
- Si el robot está desconectado, la ejecución queda en cola y se despacha al reconectar.
- Si la misma asignación ya tiene una ejecución en cola, en curso o cancelándose,
  se omite ese horario. No se acumulan ejecuciones repetidas por esa asignación.
- Tras una caída del servidor se recupera como máximo una ocurrencia pendiente por
  asignación y se calcula el siguiente horario futuro, sin reproducir todo el atraso.
- Las asignaciones manuales y desactivadas no generan ejecuciones automáticas.
- Si no hay versión publicada válida se muestra el error y se vuelve a comprobar
  en el siguiente horario. Un cron heredado inválido requiere corregir su programación.

Cambiar la programación recalcula su siguiente fecha a partir del momento del
guardado. No cancela ejecuciones que ya estaban en cola o en curso.
El planificador no cambia `updated_at` de la asignación en cada comprobación.

## Migración y despliegue

Aplicar `0009_assignment_schedules.sql` con el procedimiento de migraciones del
orquestador y reiniciar el proceso. La migración agrega zona horaria, próxima fecha
y error de programación. Los cron existentes se conservan y reciben la zona
`America/Santiago`. En la primera pasada se inicializa su próximo horario futuro;
no se ejecutan inmediatamente ni se reconstruye su historial anterior.

Se requiere mantener el orquestador Node activo. En entornos sin proceso permanente
hay que invocar `schedules` cada minuto desde el planificador de la infraestructura.
Esta entrega cubre horarios; webhooks y eventos de correo/archivos quedan pendientes.

## Verificación

`npm run test:integration` prueba sobre MariaDB desechable la migración, las
mutaciones reales, el aislamiento por empresa, cron inválido, concurrencia,
desconexión, despacho durable, solapamientos y recuperación de atraso. Las pruebas
de programación verifican las frecuencias, expresiones avanzadas, fechas mensuales
y el cambio de horario de Santiago. Completar con typecheck y build del orquestador.

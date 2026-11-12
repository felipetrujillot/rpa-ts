# Base de autorización, vinculación y cancelación

El panel utiliza identidades de usuario y el robot identidades de agente. Las operaciones del panel rechazan tokens de agente. Las operaciones compartidas filtran por empresa y un robot solo puede consultar, ejecutar o cancelar en su propio dispositivo. Los permisos se consultan nuevamente en la base; cambiar el rol, desactivar un usuario o revocar un agente invalida su acceso.

## Actualización

1. Respaldar la base y detener el despacho de ejecuciones antes de actualizar servidor y robots juntos.
2. Configurar `NUXT_JWT_SECRET` con un secreto de al menos 32 caracteres, generado fuera del repositorio. Los tokens antiguos no son compatibles con el nuevo formato.
3. Aplicar las migraciones de NuxtHub, incluidas `0005_agent_sessions_cancellation.sql` y `0006_durable_execution.sql`, usando el procedimiento de migración del entorno. La compilación no aplica migraciones. La migración 0005 desvincula los agentes existentes; es necesario generar códigos nuevos desde el panel y vincularlos nuevamente. Las ejecuciones activas antiguas se marcan como fallidas: revisar sus efectos antes de reintentarlas.
4. Configurar `ORQUESTADOR_TRPC_URL` y `VITE_ORQUESTADOR_WS_URL` al compilar el robot. Usar HTTPS y WSS fuera de localhost. El servidor debe publicar ambos bajo el mismo despliegue.
5. Iniciar el servidor y verificar inicio de sesión, vinculación y una ejecución cancelable antes de reactivar la cola.

El endpoint público `/api/admin/initial` queda deshabilitado (HTTP 410). No se crean cuentas administrativas por HTTP; el despliegue debe conservar o provisionar una cuenta mediante su procedimiento administrativo.

## Sesiones y vinculación

- Código criptográfico de un solo uso, con 15 minutos de vigencia y consumo atómico. Hay un límite por IP para login, vinculación y renovación.
- Acceso de usuario: 8 horas. Acceso de agente: 1 hora, con renovación automática al reconectar y renovación de la conexión a los 45 minutos.
- Credencial de renovación: 30 días desde la vinculación, sin renovación deslizante. Al expirar se requiere una nueva vinculación.
- El secreto de renovación se guarda cifrado con `safeStorage` en Electron, asociado al origen del servidor. Linux necesita un almacén seguro; se rechaza el backend `basic_text`.
- El WebSocket utiliza un ticket de un solo uso y 30 segundos de vigencia. El token de acceso no viaja en su URL.
- Revocar desde el panel o desvincular desde el robot elimina la sesión y el secreto de renovación del servidor y cierra el socket activo. El robot detiene su ejecución al recibir el cierre de autorización.

## Cancelación

Una ejecución en cola pasa directamente a `cancelled`. Una ejecución activa pasa a `cancelling`; conserva ocupado el dispositivo hasta que el robot confirme que terminó la acción activa. El proceso principal propaga `AbortSignal`, cierra el navegador y espera a que la acción finalice antes de liberar el controlador. Los pasos posteriores no se ejecutan.

Las solicitudes pendientes se reenvían al reconectar y en cada heartbeat. Los resultados terminales se reenvían hasta recibir confirmación del servidor. Los estados terminales no pueden revertirse por mensajes atrasados. Cancelar no deshace efectos ya realizados, y una acción síncrona de escritorio solo se detiene cuando devuelve el control.

## Validación reproducible

Desde la raíz, con dependencias instaladas:

```sh
npm run typecheck
npm test
npm run test:integration
RPA_BROWSER_CHANNEL=chrome npm run test:browser --workspace=@rpa/robot
npm run build --workspaces
```

La integración requiere Docker. Crea una instancia desechable de MariaDB 10.11 en un puerto aleatorio de localhost, aplica todas las migraciones, prueba dos empresas y elimina el contenedor al terminar. No utiliza la base de desarrollo. Cubre acceso cruzado, vinculación concurrente, expiración, revocación, tickets WebSocket y carreras de cancelación. Los sockets se simulan invocando los handlers reales; no es una prueba del proxy o transporte WebSocket desplegado.

La prueba de navegador ejecuta Chrome headless real: cancela una espera activa cerrando el navegador, verifica el resultado `cancelled` y que el siguiente paso no se ejecutó. También puede utilizar Chromium instalado por Playwright omitiendo `RPA_BROWSER_CHANNEL` o un binario indicado por `RPA_BROWSER_EXECUTABLE_PATH`.

## Límites de esta etapa

El despliegue admite un único proceso de orquestación: sockets, tickets y límites por IP viven en memoria. Antes de varias réplicas hacen falta coordinación y límites compartidos. Las reservas, comandos y confirmaciones del servidor se guardan en MySQL; el robot conserva un diario local y resultados hasta recibir confirmación del servidor.

La integración CUA incluye pruebas reales de Calculadora y TextEdit en macOS. La instalación por plataforma, el protocolo de recuperación y las limitaciones se describen en [CUA y ejecución confiable](cua-ejecucion-confiable.md). Windows y Linux requieren validación nativa en sus propios equipos. Una revocación durante una partición de red no puede interrumpir inmediatamente un equipo sin conexión; la reserva local expira a los 60 segundos sin renovación y solicita detener la acción.

# Robot RPA

Al cerrar la ventana con la X, el robot queda activo en segundo plano y conserva
la conexión con el orquestador y las ejecuciones en curso. Su ícono aparece junto
al reloj en Windows y en la barra superior en macOS.

Desde el menú del ícono, **Abrir robot** recupera la ventana y **Salir** detiene
las ejecuciones y cierra completamente la aplicación. En macOS, `Cmd+Q` también
cierra la aplicación.

Los flujos también pueden usar **Lógica → Ejecutar TypeScript** para transformar
datos y consultar APIs con permisos restringidos. Consulta
[Scripts TypeScript](../docs/typescript-scripts.md) para ejemplos y configuración
de los destinos HTTP autorizados y del SDK `rpa`. Las acciones del SDK se autorizan
en el servidor, en **Agentes → Equipo y acceso → Permisos del SDK**, y se declaran
también en el nodo. El robot consulta el permiso antes de cada llamada; sin
verificación no la ejecuta. No requiere reiniciar ni configurar variables locales.

Las acciones de navegador usan Chromium de Playwright si está instalado. Si falta,
usan Google Chrome instalado en el equipo. Las selecciones explícitas de navegador
se respetan. Si una acción falla, el SDK muestra su identificador y el error original;
una ejecución con efectos sin confirmar se detiene sin reintentar la acción.

### Microsoft Excel

El plugin propio incluye doce acciones `excel.*` para XLSX y PDF mediante Excel de escritorio. El circuito nativo está verificado en macOS; Windows permanece pendiente de validación. Consulta [uso, contrato y pruebas](../docs/plugin-microsoft-excel.md).

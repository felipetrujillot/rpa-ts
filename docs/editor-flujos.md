# Editor visual de flujos

El creador (`/admin/flujos/nuevo-flujo`) y el editor (`/admin/flujos/:uuid_flujo`)
comparten `WorkflowEditor.vue`. La lista de flujos permite abrir cualquier flujo
propio. El editor carga la última versión, aunque exista una anterior publicada.

## Edición

- Busca una acción o un paso de lógica en el catálogo. Haz clic o arrástralo al lienzo.
- El botón `+` junto a una salida agrega un paso conectado a esa rama.
- Arrastra los puertos para crear conexiones. Selecciona una conexión para eliminarla.
- Selecciona un nodo para editar sus parámetros, notas, política de error y protección
  de evidencia. Los cambios se aplican también antes de guardar o cambiar de vista.
- Los campos admiten texto, números, booleanos, referencias, JSON y valores nulos.
  Las referencias conservan el formato del motor, por ejemplo `input.valor` o `vars.nombre`.
- Los campos sugeridos usan los nombres que consume el registro de acciones del robot.
  Completa sus valores y comprueba que la acción esté disponible en el agente.
- Las condiciones tienen salidas Verdadero/Falso; los bucles tienen salidas para el
  cuerpo y para continuar. El último paso del cuerpo debe volver al nodo de bucle.
- El lienzo ofrece zoom, ajuste a pantalla, minimapa, ordenación, deshacer y rehacer.
  Dentro del lienzo: ⌘/Ctrl Z deshace, ⌘/Ctrl Mayús Z rehace, ⌘/Ctrl D duplica y
  Suprimir elimina la selección. ⌘/Ctrl S guarda desde el editor.

## Persistencia y versiones

Guardar crea una versión inmutable de borrador y actualiza el nombre del flujo.
La creación de versiones se serializa por flujo dentro de una transacción para
que dos guardados simultáneos reciban números distintos. Una versión publicada
sigue disponible para los agentes cuando se guarda un borrador posterior.

Publicar guarda los cambios y publica esa versión usando el procedimiento existente.
Cargar una versión histórica modifica el editor; guardarla crea una nueva versión.
Todas las consultas y modificaciones se limitan a la empresa autenticada.

El editor avisa antes de abandonar una página con cambios sin guardar. Las vistas
JSON y Ajustes se aplican y validan antes de volver al lienzo o guardar.

## Intercambio

Se mantiene el contrato `rpa.workflow` v2 y los adaptadores de importación y
exportación existentes. El formato de intercambio n8n admite los nodos RPA y los
nodos nativos que el adaptador implementa; no incorpora el motor ni el catálogo
de integraciones de n8n. Un nodo n8n no soportado produce un error explícito.

## Comprobación

- `npm run typecheck --workspace=@rpa/orquestador`
- `npm run build --workspace=@rpa/orquestador`
- `npm run test:integration` (usa una base MariaDB desechable en Docker)

Las pruebas del editor cubren conexiones por rama, renombrado, posiciones, bucles,
puertos inválidos, nombres únicos e historial. Las pruebas de integración cubren
carga y edición por empresa, conservación de la versión publicada y concurrencia
al guardar.

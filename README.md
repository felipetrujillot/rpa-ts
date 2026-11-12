# RPA Platform

Monorepo de automatización que integra:

- **Orquestador web** con Nuxt 4 (`@rpa/orquestador`).
- **Robot de escritorio** con Electron + Vue (`@rpa/robot`).
- **Contratos compartidos** de tipos y esquemas (`@rpa/contracts`).

## Alcance del proyecto

La plataforma permite diseñar, ejecutar y supervisar flujos de automatización híbridos:

- Automatización de escritorio mediante CUA Driver.
- Automatización web con Playwright.
- Sincronización robot-servidor vía tRPC y WebSocket.

## Estructura

- `orquestador/`: UI y backend del orquestador.
- `robot/`: aplicación de escritorio para ejecución local.
- `packages/contracts/`: contratos tipados y esquema de workflow.
- `docs/`: documentación funcional y técnica.

## Requisitos

- Node.js 20+
- npm 10+

## Instalación

```bash
npm install
```

## Desarrollo

Orquestador:

```bash
npm run dev --workspace=@rpa/orquestador
```

Robot:

```bash
npm run dev --workspace=@rpa/robot
```

## Calidad y pruebas

```bash
npm run typecheck
npm test
npm run test:integration
```

## Documentación clave

- [CUA y ejecución confiable](docs/cua-ejecucion-confiable.md)
- [Estabilización: autorización, vinculación, cancelación y actualización](docs/estabilizacion.md)
- [Workflow v2](docs/workflow-v2.md)

## Licencia

Este proyecto se distribuye bajo la licencia indicada en [LICENSE](LICENSE).

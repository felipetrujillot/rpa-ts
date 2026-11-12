# Propuestas de landing del Orquestador RPA

Objetivo: presentar el orquestador RPA a usuarios internos de RPA y conducirlos al acceso existente. Son prototipos independientes; la portada y la autenticación de Nuxt no se modifican. Los ejemplos de procesos y estados son ilustrativos.

## Sistema compartido

- Azul RPA #a20800: marca y acción principal.
- Azul profundo #071E60: texto y superficies de énfasis.
- Blanco #FFFFFF: superficie principal.
- Azul suave #F3F5FF: separación de secciones.
- Gris #66686C: texto secundario.
- Naranja #FF5A1F: acento puntual, sin utilizarlo como estado de error.
- Barlow para títulos y cuerpo; Inter para etiquetas de interfaz.
- Contenido y controles alineados a la izquierda; centrado únicamente en el hero de la segunda propuesta.

## 1. Todo bajo control

Una portada corporativa blanca con un hero azul dividido entre la promesa y una vista de ejecución de ejemplo.

```text
RPA / Orquestador                         Conocer / Ingresar
[ Promesa + acción             | Ejecución de ejemplo       ]
Diseña tus flujos       Conecta tus agentes       Sigue cada ejecución
                         Acceso al Orquestador
```

Principio: reconocer la marca inmediatamente y explicar el producto en una mirada. Sin cifras de ahorro inventadas.

## 2. Del proceso al resultado

Una portada centrada en una secuencia ejecutable de ejemplo que muestra el recorrido de un flujo; el producto es la pieza principal.

```text
RPA / Orquestador                                Ingresar
             Del proceso al resultado
             [Explorar una ejecución]
      Inicio — Leer archivo — Validar — Exportar
      Explicación del paso seleccionado
Cómo se conectan editor, agente y seguimiento
```

Principio: demostrar qué hace RPA antes de describirlo. La numeración solo representa pasos secuenciales.

## 3. Tu operación empieza aquí

Una portada de acceso con una composición vertical dividida: bienvenida editorial azul y formulario claro persistente.

```text
RPA / Orquestador                 Acceso a la plataforma
[ Bienvenida amplia            | Correo                  ]
[ Capacidades en lista         | Contraseña              ]
[ Contexto de uso interno      | Ingresar                ]
```

Principio: priorizar el regreso cotidiano del usuario interno, manteniendo la presentación del producto.

## Revisión antes de construir

Las tres propuestas cambian jerarquía, composición y tarea inicial, no solo colores. Se reemplaza una galería genérica de métricas y tarjetas por una ejecución concreta en la primera, una secuencia interactiva en la segunda y un acceso persistente en la tercera. Se conserva la marca en las tres.

## Alcance y revisión

HTML autónomo, responsive, sin dependencias de build. Controles con foco visible; no hay animación automática. Los formularios validan el formato del correo y muestran un mensaje de demostración; no envían credenciales. La conexión con el login real queda para la propuesta seleccionada.

import { createError, defineEventHandler } from "h3";
// Bootstrap data must be provisioned outside the public HTTP surface.
export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    message: "Inicialización pública deshabilitada.",
  });
});

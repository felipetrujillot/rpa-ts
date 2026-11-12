/**
 * Recibe un heartbeat de un agente y devuelve un objeto con el estado "ok" y la marca de tiempo actual en formato ISO.
 * @returns {Promise<{status: string, data: {timestamp: string}}>} Un objeto que indica que el heartbeat fue recibido correctamente y la marca de tiempo actual.
 */
export default defineEventHandler(async () => {
  return {
    status: "ok",
    data: {
      timestamp: new Date().toISOString(),
    },
  };
});

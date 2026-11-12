// Configura timeoutMs en 30000 y autoriza las acciones usadas en el nodo y el agente.
// El formulario es local: simula un registro y no envía datos a ningún servidor.
const datos = input as {
  nombre?: string;
  email?: string;
  area?: "ventas" | "soporte";
  mensaje?: string;
};
const solicitud = {
  nombre: datos.nombre ?? "Felipe Demo",
  email: datos.email ?? "felipe@example.com",
  area: datos.area ?? "soporte",
  mensaje: datos.mensaje ?? "Prueba de integración entre Playwright y CUA.",
};

const html = `<!doctype html><html lang="es"><meta charset="utf-8">
<title>Prueba RPA · Contacto</title>
<style>
body{font:16px system-ui;background:#eef2f6;color:#182838;padding:40px}
main{max-width:560px;margin:auto;background:white;padding:32px;border-radius:16px}
label{display:block;margin:18px 0}input,select,textarea,button{font:inherit;padding:10px}
input:not([type=checkbox]),select,textarea{display:block;width:95%;margin-top:6px}
button{background:#176b5b;color:white;border:0;border-radius:8px;cursor:pointer}
pre{white-space:pre-wrap;background:#e7f5ee;padding:16px}
</style><main><h1>Solicitud de contacto</h1>
<form id="contacto">
  <label>Nombre<input id="nombre" name="nombre" required></label>
  <label>Email<input id="email" name="email" type="email" required></label>
  <label>Área<select id="area" name="area"><option value="ventas">Ventas</option><option value="soporte">Soporte</option></select></label>
  <label>Mensaje<textarea id="mensaje" name="mensaje" required></textarea></label>
  <label><input id="acepto" type="checkbox" required> Confirmo esta prueba</label>
  <button type="submit">Registrar solicitud</button>
</form><pre id="confirmacion" hidden></pre>
<script>
document.querySelector('#contacto').addEventListener('submit', function(event) {
  event.preventDefault();
  const registro = Object.fromEntries(new FormData(this));
  registro.codigo = 'DEMO-001';
  const confirmacion = document.querySelector('#confirmacion');
  confirmacion.textContent = JSON.stringify(registro, null, 2);
  confirmacion.hidden = false;
  document.title = 'Solicitud registrada · RPA';
  this.querySelector('button').disabled = true;
});
</script></main></html>`;

log("1. Abriendo formulario de prueba");
const { tabId } = await rpa.browser.openTab({
  url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
});

log("2. Completando campos", solicitud);
for (const campo of ["nombre", "email", "mensaje"] as const) {
  await rpa.browser.type({
    tabId,
    selector: "#" + campo,
    text: solicitud[campo],
    clearFirst: true,
  });
}
await rpa.browser.select({ tabId, selector: "#area", value: solicitud.area });
await rpa.browser.click({ tabId, selector: "#acepto" });
await rpa.browser.click({ tabId, selector: 'button[type="submit"]' });

log("3. Verificando el registro");
await rpa.browser.waitForElement({
  tabId,
  selector: "#confirmacion",
  state: "visible",
  timeoutMs: 5000,
});
const confirmacion = await rpa.browser.evaluate({
  tabId,
  expression: "document.querySelector('#confirmacion').textContent",
});
if (typeof confirmacion.value !== "string") {
  throw new Error("El formulario no devolvió una confirmación válida.");
}
const registro = JSON.parse(confirmacion.value);
if (
  registro.nombre !== solicitud.nombre ||
  registro.email !== solicitud.email
) {
  throw new Error("Los datos registrados no coinciden con los enviados.");
}

log("4. Copiando el resultado al portapapeles del sistema mediante CUA");
const resumen = `Solicitud ${registro.codigo}\nNombre: ${registro.nombre}\nEmail: ${registro.email}\nÁrea: ${registro.area}\nMensaje: ${registro.mensaje}`;
await rpa.desktop.clipboard.write({ format: "text", value: resumen });

log("Listo. Puedes pegar el resumen con Cmd+V o Ctrl+V.");
return { correcto: true, tabId, registro, copiadoAlPortapapeles: true };

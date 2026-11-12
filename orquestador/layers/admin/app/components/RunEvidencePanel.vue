<script setup lang="ts">
import { scriptActionTraces } from "@rpa/contracts";
import {
  Camera,
  Check,
  ChevronDown,
  Circle,
  FileJson,
  Expand,
  Loader2,
  RefreshCw,
  X,
} from "lucide-vue-next";
const props = defineProps<{ runId: string }>();
const { $trpc } = useNuxtApp();
type Detail = Awaited<ReturnType<typeof $trpc.agentes.getFlowRunDetail.query>>;
const detail = shallowRef<Detail | null>(null);
const error = ref("");
const busy = ref(false);
const after = ref(0);
const image = ref("");
const imageId = ref("");
const expandedImage = ref(false);
const artifactError = ref("");
const loadingArtifact = ref(false);
let artifactRequest = 0;
const nodeLabels: Record<string, string> = {
  running: "En ejecución",
  success: "Completado",
  failed: "Fallido",
  uncertain: "Efectos por revisar",
};
let timer: ReturnType<typeof setInterval> | undefined;
const refresh = async () => {
  if (busy.value) return;
  busy.value = true;
  try {
    detail.value = await $trpc.agentes.getFlowRunDetail.query({
      uuid_flow_run: props.runId,
      after: after.value,
      limit: 100,
    });
    error.value = "";
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : "No se pudo cargar la evidencia.";
  } finally {
    busy.value = false;
  }
};
const openArtifact = async (artifactId: string) => {
  const request = ++artifactRequest;
  image.value = "";
  imageId.value = artifactId;
  artifactError.value = "";
  loadingArtifact.value = true;
  try {
    const result = await $trpc.agentes.getRunArtifact.query({
      artifact_id: artifactId,
    });
    if (request === artifactRequest) image.value = result.image_data_url;
  } catch (cause) {
    if (request === artifactRequest)
      artifactError.value =
        cause instanceof Error
          ? cause.message
          : "No se pudo cargar la captura.";
  } finally {
    if (request === artifactRequest) loadingArtifact.value = false;
  }
};
const closeArtifact = () => {
  expandedImage.value = false;
  artifactRequest++;
  image.value = "";
  imageId.value = "";
  artifactError.value = "";
  loadingArtifact.value = false;
};
const nextPage = async () => {
  after.value = detail.value?.nextAfter ?? after.value;
  await refresh();
};
const firstPage = async () => {
  after.value = 0;
  await refresh();
};
onMounted(() => {
  void refresh();
  timer = setInterval(() => {
    void refresh();
  }, 2500);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  artifactRequest++;
});
</script>

<template>
  <section class="run-evidence" aria-label="Pasos y evidencia de ejecución">
    <div class="evidence-heading">
      <div>
        <h3>Pasos y resultados</h3>
        <p>La evidencia se consulta cada 2,5 segundos.</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        :disabled="busy"
        aria-label="Actualizar evidencia"
        @click="refresh"
        ><RefreshCw :size="16" :class="{ 'animate-spin': busy }"
      /></Button>
    </div>
    <p v-if="error" class="evidence-error" role="alert">
      {{ error }} Usa Actualizar evidencia para volver a intentarlo.
    </p>
    <div v-if="!detail && busy" class="evidence-empty" role="status">
      <Loader2 :size="22" class="animate-spin" />
      <p>Cargando los pasos de la ejecución…</p>
    </div>
    <div v-else-if="detail?.run.telemetry_deleted_at" class="evidence-empty">
      <FileJson :size="25" /><strong>La evidencia fue eliminada</strong>
      <p>Los pasos, resultados y capturas ya no están disponibles.</p>
    </div>
    <template v-else-if="detail">
      <div v-if="!detail.nodes.length" class="evidence-empty">
        <Circle :size="22" /><strong>Sin pasos registrados</strong>
        <p>
          {{
            ["queued", "running", "cancelling"].includes(detail.run.status)
              ? "Los pasos aparecerán cuando el robot envíe sus eventos."
              : "No se recibieron eventos de pasos para esta ejecución."
          }}
        </p>
      </div>
      <ol v-else class="evidence-nodes" aria-label="Pasos registrados">
        <li
          v-for="node in detail.nodes"
          :key="node.uuid_node_run"
          class="evidence-node"
          :data-state="node.status"
        >
          <span class="evidence-node-mark"
            ><Check v-if="node.status === 'success'" :size="13" /><X
              v-else-if="node.status === 'failed'"
              :size="13" /><Circle v-else :size="11"
          /></span>
          <div class="evidence-node-content">
            <div class="evidence-node-heading">
              <h4>
                <span>{{ node.execution_index }}.</span>{{ node.node_name }}
              </h4>
              <span class="evidence-node-status">{{
                nodeLabels[node.status] || node.status
              }}</span>
            </div>
            <p v-if="node.error_message" class="evidence-node-error">
              {{ node.error_message }}
            </p>
            <details
              v-if="scriptActionTraces(node.output_json).length"
              class="evidence-json evidence-sdk"
            >
              <summary>
                Acciones del SDK ({{
                  scriptActionTraces(node.output_json).length
                }})<ChevronDown :size="13" />
              </summary>
              <ol aria-label="Acciones ejecutadas desde TypeScript">
                <li
                  v-for="call in scriptActionTraces(node.output_json)"
                  :key="call.sequence"
                >
                  <code>{{ call.actionId }}</code> ·
                  {{ nodeLabels[call.status] }}
                  <small v-if="call.finishedAt">
                    ·
                    {{
                      Math.max(
                        0,
                        Date.parse(call.finishedAt) -
                          Date.parse(call.startedAt),
                      )
                    }}
                    ms</small
                  >
                  <p v-if="call.message" class="evidence-node-error">
                    {{ call.errorCode }}: {{ call.message }}
                  </p>
                  <details v-if="call.output !== undefined">
                    <summary>Resultado de la acción</summary>
                    <pre>{{ JSON.stringify(call.output, null, 2) }}</pre>
                  </details>
                  <p v-else-if="call.outputOmitted">
                    Resultado omitido por el límite de evidencia.
                  </p>
                </li>
              </ol>
            </details>
            <details v-if="node.output_json !== null" class="evidence-json">
              <summary>Ver resultado<ChevronDown :size="13" /></summary>
              <pre>{{ JSON.stringify(node.output_json, null, 2) }}</pre>
            </details>
          </div>
        </li>
      </ol>
      <nav
        v-if="after > 0 || detail.nodes.length === 100"
        class="evidence-pagination"
        aria-label="Páginas de pasos"
      >
        <Button
          v-if="after > 0"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="firstPage"
          >Primeros pasos</Button
        ><Button
          v-if="detail.nodes.length === 100"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="nextPage"
          >Siguientes pasos</Button
        >
      </nav>
      <details
        v-if="
          detail.run.output_json !== null &&
          detail.run.output_json !== undefined
        "
        class="evidence-json evidence-flow-output"
      >
        <summary>
          <FileJson :size="16" />Resultado del flujo<ChevronDown :size="14" />
        </summary>
        <pre>{{ JSON.stringify(detail.run.output_json, null, 2) }}</pre>
      </details>
      <div v-if="detail.artifacts.length" class="evidence-artifacts">
        <h3>
          <Camera :size="16" />Capturas guardadas<span>{{
            detail.artifacts.length
          }}</span>
        </h3>
        <div class="evidence-artifact-list">
          <button
            v-for="(artifact, index) in detail.artifacts"
            :key="artifact.artifact_id"
            class="evidence-artifact"
            :class="{ 'is-selected': imageId === artifact.artifact_id }"
            type="button"
            :aria-pressed="imageId === artifact.artifact_id"
            @click="openArtifact(artifact.artifact_id)"
          >
            <Camera :size="18" /><span
              ><strong>Captura {{ index + 1 }}</strong
              ><span
                >{{ Math.ceil(artifact.byte_length / 1024) }} KB</span
              ></span
            >
          </button>
        </div>
        <div v-if="imageId" class="evidence-image-viewer">
          <div>
            <span>Vista de captura</span>
            <Button
              v-if="image"
              variant="ghost"
              size="sm"
              aria-label="Ampliar captura"
              @click="expandedImage = true"
              ><Expand :size="14" />Ampliar</Button
            >
            <Button
              variant="ghost"
              size="sm"
              aria-label="Cerrar captura"
              @click="closeArtifact"
              ><X :size="15" />Cerrar</Button
            >
          </div>
          <p v-if="loadingArtifact" role="status">Cargando captura…</p>
          <p v-else-if="artifactError" class="evidence-error" role="alert">
            {{ artifactError }}
          </p>
          <img
            v-else-if="image"
            :src="image"
            :alt="`Captura de ejecución ${imageId}`"
          />
        </div>
      </div>
    </template>
    <Dialog v-model:open="expandedImage"
      ><DialogContent class="evidence-capture-dialog"
        ><DialogHeader
          ><DialogTitle>Captura de ejecución</DialogTitle
          ><DialogDescription
            >Imagen guardada como evidencia de esta
            ejecución.</DialogDescription
          ></DialogHeader
        ><DialogClose
          class="evidence-dialog-close"
          aria-label="Cerrar captura ampliada"
          ><X :size="18" /></DialogClose
        ><img
          v-if="image"
          :src="image"
          :alt="`Captura ampliada de ejecución ${imageId}`" /></DialogContent
    ></Dialog>
  </section>
</template>

<style scoped src="../assets/run-evidence.css"></style>

<style scoped>
.evidence-sdk ol {
  margin: 8px 0;
  padding-left: 22px;
}
.evidence-sdk li {
  padding: 6px 0;
  overflow-wrap: anywhere;
}
.evidence-sdk code,
.evidence-sdk small {
  font-size: 11px;
}
</style>

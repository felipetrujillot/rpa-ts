<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Copy, ImagePlus, Loader2, RotateCcw } from "lucide-vue-next";
import {
  MAX_IMAGE_ASSET_BYTES,
  IMAGE_ASSET_CONTENT_TYPES,
  type ImageAsset,
  type ImageAssetPage,
} from "@rpa/contracts";
const props = defineProps<{ selectable?: boolean }>();
const emit = defineEmits<{ select: [asset: ImageAsset] }>();

const items = ref<ImageAsset[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const uploading = ref(false);
const error = ref("");
const notice = ref("");
const fileInput = ref<HTMLInputElement>();
const failedPreviews = ref(new Set<string>());
const busy = computed(() => loading.value || uploading.value);
function message(e: unknown) {
  const failure = e as { data?: { message?: string }; message?: string };
  return (
    failure.data?.message ??
    failure.message ??
    "No se pudo completar la operación."
  );
}
async function load(more = false) {
  if (busy.value) return;
  loading.value = true;
  error.value = "";
  try {
    const page = await $fetch<ImageAssetPage>("/api/assets", {
      query: more ? { cursor: nextCursor.value } : undefined,
    });
    const existing = new Set(items.value.map((asset) => asset.id));
    items.value = more
      ? [
          ...items.value,
          ...page.items.filter((asset) => !existing.has(asset.id)),
        ]
      : page.items;
    nextCursor.value = page.nextCursor;
    if (!more) failedPreviews.value = new Set();
  } catch (e) {
    error.value = message(e);
  } finally {
    loading.value = false;
  }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || busy.value) return;
  error.value = "";
  notice.value = "";
  if (
    !IMAGE_ASSET_CONTENT_TYPES.some((type) => type === file.type) ||
    !file.size ||
    file.size > MAX_IMAGE_ASSET_BYTES
  ) {
    error.value = "Selecciona una imagen PNG, JPEG o WebP de hasta 10 MiB.";
    return;
  }
  uploading.value = true;
  try {
    const asset = await $fetch<ImageAsset>("/api/assets", {
      method: "POST",
      query: { name: file.name },
      headers: { "Content-Type": file.type },
      body: file,
    });
    items.value = [asset, ...items.value];
    notice.value = `Imagen «${asset.originalName}» guardada. Puedes copiar su ID.`;
    if (props.selectable) emit("select", asset);
  } catch (e) {
    error.value = message(e);
  } finally {
    uploading.value = false;
  }
}
async function copy(asset: ImageAsset) {
  try {
    await navigator.clipboard.writeText(asset.id);
    notice.value = `ID de «${asset.originalName}» copiado.`;
  } catch {
    error.value = "No se pudo copiar. Selecciona el ID y cópialo manualmente.";
  }
}
onMounted(() => load());
</script>

<template>
  <section class="wf-assets" aria-label="Biblioteca de imágenes">
    <div class="wf-assets-heading">
      <div>
        <h3>Imágenes</h3>
        <p>
          Biblioteca compartida de tu empresa. Las imágenes se guardan al
          subirlas y puedes reutilizar su ID en los flujos.
        </p>
        <small
          >PNG, JPEG o WebP estático · Máximo 10 MiB y 25 megapíxeles.</small
        >
      </div>
      <div class="wf-assets-actions">
        <button
          type="button"
          class="wf-button"
          :disabled="busy"
          @click="load()"
        >
          <RotateCcw :size="14" /> Actualizar
        </button>
        <button
          type="button"
          class="wf-button wf-button-primary"
          :disabled="busy"
          @click="fileInput?.click()"
        >
          <Loader2 v-if="uploading" :size="14" class="wf-spin" /><ImagePlus
            v-else
            :size="14"
          />
          {{ uploading ? "Subiendo…" : "Subir imagen" }}
        </button>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      aria-label="Subir imagen"
      @change="upload"
    />
    <p v-if="error" role="alert" class="wf-error">{{ error }}</p>
    <p v-if="notice" role="status" class="wf-assets-notice">{{ notice }}</p>
    <div v-if="loading && !items.length" class="wf-loading">
      <Loader2 :size="18" class="wf-spin" /> Cargando imágenes…
    </div>
    <p v-else-if="!items.length && !error" class="wf-muted">
      Aún no hay imágenes. Sube un recorte del botón o la sección que quieras
      usar como referencia.
    </p>
    <ul v-if="items.length" class="wf-assets-grid">
      <li v-for="asset in items" :key="asset.id" class="wf-asset">
        <div class="wf-asset-preview">
          <span v-if="failedPreviews.has(asset.id)" role="status"
            >No se pudo cargar la vista previa.</span
          >
          <img
            v-else
            :src="`/api/assets/${asset.id}/content`"
            :alt="asset.originalName"
            loading="lazy"
            @error="failedPreviews.add(asset.id)"
          />
        </div>
        <strong :title="asset.originalName">{{ asset.originalName }}</strong>
        <small
          >{{ asset.width }} × {{ asset.height }} px ·
          {{ (asset.byteLength / 1024).toFixed(1) }} KiB</small
        >
        <label
          >ID de imagen<input
            :value="asset.id"
            readonly
            :aria-label="`ID de ${asset.originalName}`"
            @focus="($event.target as HTMLInputElement).select()"
        /></label>
        <button type="button" class="wf-button" @click="copy(asset)">
          <Copy :size="13" /> Copiar ID
        </button>
        <button v-if="selectable" type="button" class="wf-button wf-button-primary" @click="emit('select', asset)">Usar esta imagen</button>
      </li>
    </ul>
    <button
      v-if="nextCursor"
      type="button"
      class="wf-button"
      :disabled="busy"
      @click="load(true)"
    >
      {{ loading ? "Cargando…" : "Cargar más" }}
    </button>
  </section>
</template>

<style scoped>
.wf-assets {
  padding: 28px;
  max-width: 1280px;
  margin: 0 auto;
}
.wf-assets-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
}
.wf-assets h3 {
  font-size: 18px;
  font-weight: 600;
}
.wf-assets p {
  margin: 8px 0;
}
.wf-assets small {
  color: var(--muted-foreground);
}
.wf-assets-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.wf-assets-grid {
  list-style: none;
  padding: 0;
  margin: 24px 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}
.wf-asset {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  background: var(--card);
}
.wf-asset-preview {
  height: 150px;
  background: var(--muted);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.wf-asset-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.wf-asset-preview span {
  font-size: 12px;
  padding: 16px;
}
.wf-asset strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wf-asset label {
  font-size: 12px;
  display: grid;
  gap: 5px;
}
.wf-asset input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 8px;
  font-family: monospace;
  font-size: 11px;
}
.wf-assets-notice {
  color: var(--primary);
}
@media (max-width: 700px) {
  .wf-assets {
    padding: 16px;
  }
  .wf-assets-heading {
    flex-direction: column;
  }
  .wf-assets-actions {
    flex-wrap: wrap;
  }
}
</style>

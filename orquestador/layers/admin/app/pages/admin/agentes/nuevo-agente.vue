<script setup lang="ts">
documentTitle("Nuevo Agente");

const { $trpc } = useNuxtApp();
const router = useRouter();

const form = ref({
  nombre: "",
});
const isSubmitting = ref(false);

const validaForm = () => {
  const nombre = form.value.nombre.trim();
  if (!nombre || nombre.length < 3) {
    return true;
  }

  return false;
};

const nombreError = computed(() => {
  const nombre = form.value.nombre.trim();

  if (!nombre) {
    return "Debes ingresar el nombre del agente";
  }

  if (nombre.length < 3) {
    return "El nombre debe tener al menos 3 caracteres";
  }

  return "";
});

const addAgente = async () => {
  if (isSubmitting.value) {
    return;
  }

  const hasError = validaForm();
  if (hasError) {
    return toast(
      "warning",
      "Debes completar el formulario correctamente para poder continuar",
    );
  }

  isSubmitting.value = true;

  try {
    const res = await $trpc.agentes.addAgente.mutate({
      nombre: form.value.nombre.trim(),
    });

    if (res.status === "ok") {
      await toast("success", "Agente creado correctamente");
      await router.push(`/admin/agentes/${res.data.uuid_agente}`);
    }
  } catch {
    await toast("error", "No se pudo crear el agente. Intenta nuevamente");
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div class="mx-auto w-full max-w-2xl space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Nuevo Agente</h1>
      <p class="text-sm text-muted-foreground mt-1">
        Crea un nuevo agente RPA para tu empresa.
      </p>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Datos del agente</CardTitle>
        <CardDescription>
          El nombre será visible en el listado de agentes.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form class="space-y-5" @submit.prevent="addAgente">
          <div class="space-y-2">
            <FormLabel text="Nombre" :required="true">
              <Input
                id="nombre"
                v-model="form.nombre"
                type="text"
                placeholder="Ej: Agente de Facturación"
                :disabled="isSubmitting"
                maxlength="120"
              />
            </FormLabel>
            <p
              v-if="form.nombre.length > 0 && nombreError"
              class="text-sm text-destructive"
            >
              {{ nombreError }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <Button type="submit" :disabled="isSubmitting || validaForm()">
              {{ isSubmitting ? "Guardando..." : "Crear Agente" }}
            </Button>

            <Button
              type="button"
              variant="outline"
              :disabled="isSubmitting"
              @click="router.push('/admin/agentes')"
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

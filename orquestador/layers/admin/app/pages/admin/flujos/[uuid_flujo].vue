<script setup lang="ts">
documentTitle("Editar flujo");
const route = useRoute();
const uuid = computed(() => String(route.params.uuid_flujo));
</script>
<template><WorkflowEditor :key="uuid" :uuid="uuid" /></template>

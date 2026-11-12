<script setup lang="ts">
import { computed, watch } from "vue";
import {
  describeSchedule,
  scheduleToCron,
  upcomingSchedule,
  weekDays,
  type ScheduleDraft,
} from "~~/shared/schedule";

const form = defineModel<ScheduleDraft>({ required: true });
const props = defineProps<{ idPrefix: string; disabled?: boolean }>();
const emit = defineEmits<{ validityChange: [valid: boolean] }>();
const frequencies = [
  { value: "manual", label: "Solo manualmente" },
  { value: "minutes", label: "Cada ciertos minutos" },
  { value: "hours", label: "Cada ciertas horas" },
  { value: "daily", label: "Todos los días" },
  { value: "weekdays", label: "De lunes a viernes" },
  { value: "weekly", label: "Días de la semana" },
  { value: "monthly", label: "Un día de cada mes" },
  { value: "advanced", label: "Cron avanzado" },
];
const intervals = computed(() =>
  form.value.mode === "minutes"
    ? [1, 5, 10, 15, 20, 30]
    : [1, 2, 3, 4, 6, 8, 12],
);
watch(
  () => form.value.mode,
  (mode, previousMode) => {
    if (mode === "advanced" && previousMode !== "manual") {
      try {
        form.value.cron = scheduleToCron({ ...form.value, mode: previousMode });
      } catch {
        /* Keep the previous expression while the incomplete preset is edited. */
      }
    }
    if (
      (mode === "minutes" || mode === "hours") &&
      !intervals.value.includes(form.value.interval)
    )
      form.value.interval = mode === "minutes" ? 15 : 1;
  },
);
const preview = computed(() => {
  try {
    const cron = scheduleToCron(form.value);
    if (form.value.mode !== "manual" && !cron)
      throw new Error("Escribe una expresión cron.");
    return {
      cron,
      dates: upcomingSchedule(cron, form.value.timezone),
      error: "",
    };
  } catch (error) {
    return { cron: "", dates: [], error: (error as Error).message };
  }
});
watch(
  () => preview.value.error,
  (error) => emit("validityChange", !error),
  { immediate: true },
);
const summary = computed(() =>
  describeSchedule(preview.value.cron, form.value.timezone),
);
const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: form.value.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
const timezones = [
  "America/Santiago",
  "America/Punta_Arenas",
  "Pacific/Easter",
  "America/Lima",
  "America/Bogota",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "Europe/Madrid",
  "UTC",
];
</script>

<template>
  <fieldset class="schedule-editor" :disabled="props.disabled">
    <legend>Programación</legend>
    <div>
      <label :for="`${idPrefix}-frequency`">¿Cuándo se ejecuta?</label>
      <select :id="`${idPrefix}-frequency`" v-model="form.mode">
        <option
          v-for="frequency in frequencies"
          :key="frequency.value"
          :value="frequency.value"
        >
          {{ frequency.label }}
        </option>
      </select>
    </div>
    <div v-if="form.mode === 'minutes' || form.mode === 'hours'">
      <label :for="`${idPrefix}-interval`">Repetir cada</label>
      <select :id="`${idPrefix}-interval`" v-model.number="form.interval">
        <option v-for="interval in intervals" :key="interval" :value="interval">
          {{ interval }}
          {{
            form.mode === "minutes"
              ? interval === 1
                ? "minuto"
                : "minutos"
              : interval === 1
                ? "hora"
                : "horas"
          }}
        </option>
      </select>
      <p class="schedule-help">
        {{
          form.mode === "minutes"
            ? "Los intervalos se cuentan desde el minuto 00 de cada hora."
            : "Los intervalos se cuentan desde las 00:00, al minuto 00."
        }}
      </p>
    </div>
    <fieldset v-if="form.mode === 'weekly'" class="schedule-days">
      <legend>Días de ejecución</legend>
      <label v-for="day in weekDays" :key="day.value">
        <input v-model="form.days" type="checkbox" :value="day.value" />{{
          day.label
        }}
      </label>
    </fieldset>
    <div v-if="form.mode === 'monthly'">
      <label :for="`${idPrefix}-day`">Día del mes</label>
      <input
        :id="`${idPrefix}-day`"
        v-model.number="form.monthDay"
        type="number"
        min="1"
        max="31"
        required
      />
      <p v-if="form.monthDay > 28" class="schedule-help">
        Los meses que no tengan ese día se omitirán.
      </p>
    </div>
    <div v-if="['daily', 'weekdays', 'weekly', 'monthly'].includes(form.mode)">
      <label :for="`${idPrefix}-time`">Hora de ejecución</label>
      <input
        :id="`${idPrefix}-time`"
        v-model="form.time"
        type="time"
        required
      />
    </div>
    <div v-if="form.mode === 'advanced'">
      <label :for="`${idPrefix}-cron`">Expresión cron</label>
      <input
        :id="`${idPrefix}-cron`"
        v-model="form.cron"
        maxlength="120"
        placeholder="*/15 * * * *"
        :aria-describedby="`${idPrefix}-cron-help`"
        required
      />
      <p :id="`${idPrefix}-cron-help`" class="schedule-help">
        Cinco campos: minuto, hora, día del mes, mes y día de la semana.
      </p>
    </div>
    <div v-if="form.mode !== 'manual'">
      <label :for="`${idPrefix}-timezone`">Zona horaria</label>
      <input
        :id="`${idPrefix}-timezone`"
        v-model.trim="form.timezone"
        :list="`${idPrefix}-timezones`"
        maxlength="100"
        placeholder="America/Santiago"
        required
      />
      <datalist :id="`${idPrefix}-timezones`">
        <option
          v-for="timezone in timezones"
          :key="timezone"
          :value="timezone"
        />
      </datalist>
      <p class="schedule-help">
        La hora se interpreta en esta zona, incluidos sus cambios de horario.
      </p>
    </div>
    <p v-if="preview.error" class="schedule-error" role="alert">
      {{ preview.error }}
    </p>
    <div v-else class="schedule-preview" aria-live="polite">
      <p class="schedule-summary">{{ summary }}</p>
      <template v-if="form.mode !== 'manual'">
        <p class="schedule-help">Próximas ejecuciones · {{ form.timezone }}</p>
        <ul>
          <li v-for="date in preview.dates" :key="date.toISOString()">
            {{ formatDate(date) }}
          </li>
        </ul>
        <p class="schedule-help">
          Si esta asignación ya tiene una ejecución en cola o en curso, se
          omitirá ese horario.
        </p>
      </template>
    </div>
  </fieldset>
</template>

<style scoped>
.schedule-editor {
  border: 0;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 16px;
  min-width: 0;
}
.schedule-editor > legend {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 14px;
}
.schedule-editor label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 7px;
}
.schedule-editor select,
.schedule-editor input {
  box-sizing: border-box;
  display: block;
  height: 42px;
  width: 100%;
  border: 1px solid #cbd4e5;
  border-radius: 7px;
  background: #fff;
  padding: 0 11px;
  color: #071e60;
  font: inherit;
  font-size: 13px;
}
.schedule-editor :where(input, select):focus-visible {
  outline: 3px solid #002eff;
  outline-offset: 3px;
}
.schedule-editor :disabled {
  opacity: 0.65;
}
.schedule-editor .schedule-help {
  font-size: 12px;
  color: #606d87;
  margin: 6px 0 0;
  line-height: 1.5;
}
.schedule-days {
  border: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.schedule-days legend {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 500;
}
.schedule-days label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  margin: 0;
}
.schedule-days input {
  width: 16px;
  height: 16px;
  padding: 0;
  accent-color: #002eff;
}
.schedule-preview {
  border-top: 1px solid #e9edf5;
  padding-top: 14px;
}
.schedule-summary {
  font-weight: 600;
  margin: 0;
}
.schedule-preview ul {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.8;
}
.schedule-error {
  color: #b42318;
  font-size: 13px;
  margin: 0;
}
</style>

<script lang="ts" setup>
import type { CalendarRootEmits, CalendarRootProps, DateValue } from "reka-ui";
import type { HTMLAttributes, Ref } from "vue";
import type { LayoutTypes } from ".";
import { getLocalTimeZone, today } from "@internationalized/date";
import { createReusableTemplate, reactiveOmit, useVModel } from "@vueuse/core";
import { CalendarRoot, useDateFormatter, useForwardPropsEmits } from "reka-ui";
import { createYear, createYearRange, toDate } from "reka-ui/date";
import { computed, toRaw } from "vue";
import { cn } from "@/lib/utils";
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeader,
  CalendarHeading,
  CalendarNextButton,
  CalendarPrevButton,
} from ".";

const props = withDefaults(
  defineProps<
    CalendarRootProps & {
      class?: HTMLAttributes["class"];
      layout?: LayoutTypes;
      yearRange?: DateValue[];
      highlightedDates?: string[];
      dayTriggerClass?: HTMLAttributes["class"];
      dashboard?: boolean;
    }
  >(),
  {
    modelValue: undefined,
    layout: undefined,
  },
);
const emits = defineEmits<CalendarRootEmits>();

const delegatedProps = reactiveOmit(
  props,
  "class",
  "layout",
  "placeholder",
  "dayTriggerClass",
);

const placeholder = useVModel(props, "placeholder", emits, {
  passive: true,
  defaultValue: props.defaultPlaceholder ?? today(getLocalTimeZone()),
}) as Ref<DateValue>;

const formatter = useDateFormatter(props.locale ?? "en");

const yearRange = computed(() => {
  return (
    props.yearRange ??
    createYearRange({
      start:
        props?.minValue ??
        (
          toRaw(props.placeholder) ??
          props.defaultPlaceholder ??
          today(getLocalTimeZone())
        ).cycle("year", -106),

      end:
        props?.maxValue ??
        (
          toRaw(props.placeholder) ??
          props.defaultPlaceholder ??
          today(getLocalTimeZone())
        ).cycle("year", 10),
    })
  );
});

const highlightedDateSet = computed(() => {
  return new Set(props.highlightedDates ?? []);
});

const todayDateString = computed(() => {
  return today(getLocalTimeZone()).toString();
});

const [DefineMonthTemplate, ReuseMonthTemplate] = createReusableTemplate<{
  date: DateValue;
}>();
const [DefineYearTemplate, ReuseYearTemplate] = createReusableTemplate<{
  date: DateValue;
}>();

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const convertFullDay = (day: string) => {
  if (props.dashboard === false) return day;
  if (day === "L") return "Lunes";
  if (day === "M") return "Martes";
  if (day === "X") return "Miércoles";
  if (day === "J") return "Jueves";
  if (day === "V") return "Viernes";
  if (day === "S") return "Sábado";
  if (day === "D") return "Domingo";
  return day;
};

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
</script>

<template>
  <DefineMonthTemplate v-slot="{ date }">
    <div class="**:data-[slot=native-select-icon]:right-1">
      <div class="relative">
        <div
          class="absolute inset-0 flex h-full items-center text-sm pl-2 pointer-events-none"
        >
          {{ capitalize(formatter.custom(toDate(date), { month: "long" })) }}
        </div>
        <NativeSelect
          class="text-xs h-8 pr-6 pl-2 text-transparent relative"
          @change="
            (e: Event) => {
              placeholder = placeholder.set({
                month: Number((e?.target as any)?.value),
              });
            }
          "
        >
          <NativeSelectOption
            v-for="month in createYear({ dateObj: date })"
            :key="month.toString()"
            :value="month.month"
            :selected="date.month === month.month"
          >
            {{ capitalize(formatter.custom(toDate(month), { month: "long" })) }}
          </NativeSelectOption>
        </NativeSelect>
      </div>
    </div>
  </DefineMonthTemplate>

  <DefineYearTemplate v-slot="{ date }">
    <div class="**:data-[slot=native-select-icon]:right-1">
      <div class="relative">
        <div
          class="absolute inset-0 flex h-full items-center text-sm pl-2 pointer-events-none"
        >
          {{ formatter.custom(toDate(date), { year: "numeric" }) }}
        </div>
        <NativeSelect
          class="text-xs h-8 pr-6 pl-2 text-transparent relative"
          @change="
            (e: Event) => {
              placeholder = placeholder.set({
                year: Number((e?.target as any)?.value),
              });
            }
          "
        >
          <NativeSelectOption
            v-for="year in yearRange"
            :key="year.toString()"
            :value="year.year"
            :selected="date.year === year.year"
          >
            {{ formatter.custom(toDate(year), { year: "numeric" }) }}
          </NativeSelectOption>
        </NativeSelect>
      </div>
    </div>
  </DefineYearTemplate>

  <CalendarRoot
    v-slot="{ grid, weekDays, date }"
    v-bind="forwarded"
    v-model:placeholder="placeholder"
    data-slot="calendar"
    :class="cn('p-3', props.class)"
  >
    <CalendarHeader class="pt-0">
      <nav
        class="flex items-center gap-1 absolute top-0 inset-x-0 justify-between"
      >
        <CalendarPrevButton>
          <slot name="calendar-prev-icon" />
        </CalendarPrevButton>
        <CalendarNextButton>
          <slot name="calendar-next-icon" />
        </CalendarNextButton>
      </nav>

      <slot
        name="calendar-heading"
        :date="date"
        :month="ReuseMonthTemplate"
        :year="ReuseYearTemplate"
      >
        <template v-if="layout === 'month-and-year'">
          <div class="flex items-center justify-center gap-1">
            <ReuseMonthTemplate :date="date" />
            <ReuseYearTemplate :date="date" />
          </div>
        </template>
        <template v-else-if="layout === 'month-only'">
          <div class="flex items-center justify-center gap-1">
            <ReuseMonthTemplate :date="date" />
            {{ formatter.custom(toDate(date), { year: "numeric" }) }}
          </div>
        </template>
        <template v-else-if="layout === 'year-only'">
          <div class="flex items-center justify-center gap-1">
            {{ formatter.custom(toDate(date), { month: "short" }) }}
            <ReuseYearTemplate :date="date" />
          </div>
        </template>
        <template v-else>
          <CalendarHeading />
        </template>
      </slot>
    </CalendarHeader>

    <div class="flex flex-col gap-y-4 mt-4 sm:flex-row sm:gap-x-4 sm:gap-y-0">
      <CalendarGrid v-for="month in grid" :key="month.value.toString()">
        <CalendarGridHead>
          <CalendarGridRow>
            <CalendarHeadCell
              v-for="day in weekDays"
              :key="day"
              class="border rounded-none bg-primary text-white font-semibold py-2"
            >
              <span class="block md:hidden">
                {{ day.charAt(0) }}
              </span>
              <span class="hidden md:block">
                {{ convertFullDay(day) }}
              </span>
            </CalendarHeadCell>
          </CalendarGridRow>
        </CalendarGridHead>
        <CalendarGridBody>
          <CalendarGridRow
            v-for="(weekDates, index) in month.rows"
            :key="`weekDate-${index}`"
            class="w-full"
          >
            <CalendarCell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
              class="border rounded-none"
            >
              <template v-if="$slots['day-content']">
                <CalendarCellTrigger
                  :day="weekDate"
                  :month="month.value"
                  :class="
                    cn(
                      highlightedDateSet.has(weekDate.toString())
                        ? 'ring-1 ring-primary/70 bg-primary/10 hover:bg-primary/15 rounded-none'
                        : undefined,
                      props.dayTriggerClass,
                    )
                  "
                >
                  <slot
                    name="day-content"
                    :date="weekDate"
                    :month="month.value"
                    :is-highlighted="
                      highlightedDateSet.has(weekDate.toString())
                    "
                    :is-today="weekDate.toString() === todayDateString"
                  />
                </CalendarCellTrigger>
              </template>
              <CalendarCellTrigger
                v-else
                :day="weekDate"
                :month="month.value"
                :class="
                  cn(
                    highlightedDateSet.has(weekDate.toString())
                      ? 'ring-1 ring-primary/70 bg-primary/10 hover:bg-primary/15 rounded-none'
                      : undefined,
                    props.dayTriggerClass,
                  )
                "
              />
            </CalendarCell>
          </CalendarGridRow>
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  </CalendarRoot>
</template>

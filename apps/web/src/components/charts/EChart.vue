<script lang="ts">
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  DatasetComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Só os módulos usados (tree-shaking): registrados uma única vez para todas as instâncias.
echarts.use([
  PieChart, BarChart, LineChart,
  TitleComponent, TooltipComponent, LegendComponent, GridComponent, DatasetComponent, MarkLineComponent,
  CanvasRenderer,
]);
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { EChartsOption } from "echarts";
import { useThemeColors } from "../../lib/use-theme-colors";
import type { ThemeColors } from "../../lib/theme-colors";

export interface EChartClick {
  name: string;
  seriesName: string;
  dataIndex: number;
}

const props = withDefaults(
  defineProps<{
    /** Opção pronta ou função das cores do tema (reavaliada quando o tema muda). */
    option: EChartsOption | ((colors: ThemeColors) => EChartsOption);
    height?: number;
    /** Descrição para leitores de tela. */
    label?: string;
  }>(),
  { height: 280, label: undefined },
);
const emit = defineEmits<{ click: [payload: EChartClick] }>();

const el = ref<HTMLDivElement | null>(null);
const chart = shallowRef<echarts.ECharts | null>(null);
const colors = useThemeColors();
let resizeObserver: ResizeObserver | null = null;

const resolved = computed<EChartsOption>(() => (typeof props.option === "function" ? props.option(colors.value) : props.option));

function render() {
  chart.value?.setOption(resolved.value, { notMerge: true });
}

onMounted(() => {
  if (!el.value) return;
  const instance = echarts.init(el.value, undefined, { renderer: "canvas" });
  chart.value = instance;
  instance.on("click", (p: { name?: string; seriesName?: string; dataIndex?: number }) => {
    emit("click", { name: p.name ?? "", seriesName: p.seriesName ?? "", dataIndex: p.dataIndex ?? 0 });
  });
  render();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => chart.value?.resize());
    resizeObserver.observe(el.value);
  }
});

watch(resolved, render);
watch(() => props.height, () => chart.value?.resize(), { flush: "post" });

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart.value?.dispose();
  chart.value = null;
});
</script>

<template>
  <div ref="el" class="echart" role="img" :aria-label="label" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.echart { width: 100%; min-width: 0; }
</style>

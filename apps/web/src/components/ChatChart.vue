<template>
  <div ref="chartEl" class="chat-chart" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import * as echarts from "echarts/core";
import { PieChart, BarChart, LineChart } from "echarts/charts";
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { themeColors } from "../lib/theme-colors";
import { formatBRL, formatBRLCompact } from "../lib/money";

echarts.use([PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

interface ChartSpec {
  type: "pie" | "bar" | "line";
  title: string;
  series: Array<{ name: string; value: number }>;
}

const props = defineProps<{ spec: ChartSpec }>();
const chartEl = ref<HTMLDivElement | null>(null);
let instance: echarts.ECharts | null = null;

function buildOption(spec: ChartSpec): echarts.EChartsCoreOption {
  const fmt = (v: number) => formatBRL(v);
  const fmtAxis = (v: number) => formatBRLCompact(v);
  const c = themeColors();
  const text = { color: c.text, fontFamily: c.fontSans };
  const muted = { color: c.textMuted, fontFamily: c.fontSans };
  const axisLine = { lineStyle: { color: c.border } };
  const splitLine = { lineStyle: { color: c.border } };
  const tooltip = { backgroundColor: c.surface, borderColor: c.border, textStyle: text };
  const palette = [c.accent, c.pf, c.pj, c.transfer, c.warning, c.expense, c.income];

  if (spec.type === "pie") {
    return {
      color: palette,
      title: { text: spec.title, left: "center", textStyle: { ...text, fontSize: 13 } },
      tooltip: { ...tooltip, trigger: "item", formatter: (p: any) => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
      legend: { orient: "vertical", right: "5%", top: "center", textStyle: muted },
      series: [{ type: "pie", radius: ["35%", "60%"], data: spec.series, label: text, itemStyle: { borderColor: c.surface, borderWidth: 2 } }],
    };
  }

  if (spec.type === "line") {
    // Group months: extract unique months from names like "2026-06 receita"
    const months = [...new Set(spec.series.map((s) => s.name.split(" ")[0]))];
    const incomes = months.map((m) => spec.series.find((s) => s.name === `${m} receita`)?.value ?? 0);
    const expenses = months.map((m) => spec.series.find((s) => s.name === `${m} despesa`)?.value ?? 0);
    return {
      title: { text: spec.title, textStyle: { ...text, fontSize: 13 } },
      tooltip: { ...tooltip, trigger: "axis", valueFormatter: fmt },
      legend: { data: ["Receita", "Despesa"], textStyle: muted },
      xAxis: { type: "category", data: months, axisLabel: muted, axisLine },
      yAxis: { type: "value", axisLabel: { ...muted, formatter: fmtAxis }, splitLine },
      series: [
        { name: "Receita", type: "line", data: incomes, smooth: true, color: c.income, itemStyle: { color: c.income }, lineStyle: { color: c.income } },
        { name: "Despesa", type: "line", data: expenses, smooth: true, color: c.expense, itemStyle: { color: c.expense }, lineStyle: { color: c.expense } },
      ],
    };
  }

  // bar (cashflow)
  return {
    color: palette,
    title: { text: spec.title, textStyle: { ...text, fontSize: 13 } },
    tooltip: { ...tooltip, trigger: "axis", valueFormatter: fmt },
    xAxis: { type: "category", data: spec.series.map((s) => s.name), axisLabel: muted, axisLine },
    yAxis: { type: "value", axisLabel: { ...muted, formatter: fmtAxis }, splitLine },
    series: [{ type: "bar", data: spec.series.map((s) => s.value), itemStyle: { color: c.accent } }],
  };
}

function render() {
  if (!chartEl.value) return;
  if (!instance) instance = echarts.init(chartEl.value);
  instance.setOption({ backgroundColor: "transparent", ...buildOption(props.spec) }, true);
}

// Re-renderiza quando o tema muda (toggle manual altera data-theme; sistema altera prefers-color-scheme).
let observer: MutationObserver | null = null;
let media: MediaQueryList | null = null;

onMounted(() => {
  render();
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(render);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  if (typeof window.matchMedia === "function") {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", render);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  media?.removeEventListener("change", render);
  instance?.dispose();
  instance = null;
});
watch(() => props.spec, render, { deep: true });
</script>

<style scoped>
.chat-chart { width: 100%; height: 260px; }
</style>

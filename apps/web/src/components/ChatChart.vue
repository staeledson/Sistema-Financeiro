<template>
  <div ref="chartEl" class="chat-chart" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import * as echarts from "echarts/core";
import { PieChart, BarChart, LineChart } from "echarts/charts";
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

interface ChartSpec {
  type: "pie" | "bar" | "line";
  title: string;
  series: Array<{ name: string; value: number }>;
}

const props = defineProps<{ spec: ChartSpec }>();
const chartEl = ref<HTMLDivElement | null>(null);
let instance: echarts.ECharts | null = null;

function buildOption(spec: ChartSpec): echarts.EChartsOption {
  const fmt = (v: number) => `R$ ${(v / 100).toFixed(2)}`;

  if (spec.type === "pie") {
    return {
      title: { text: spec.title, left: "center", textStyle: { fontSize: 13, color: "#ccc" } },
      tooltip: { trigger: "item", formatter: (p: any) => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
      legend: { orient: "vertical", right: "5%", top: "center", textStyle: { color: "#aaa" } },
      series: [{ type: "pie", radius: ["35%", "60%"], data: spec.series, label: { color: "#ccc" } }],
    };
  }

  if (spec.type === "line") {
    // Group months: extract unique months from names like "2026-06 receita"
    const months = [...new Set(spec.series.map((s) => s.name.split(" ")[0]))];
    const incomes = months.map((m) => spec.series.find((s) => s.name === `${m} receita`)?.value ?? 0);
    const expenses = months.map((m) => spec.series.find((s) => s.name === `${m} despesa`)?.value ?? 0);
    return {
      title: { text: spec.title, textStyle: { fontSize: 13, color: "#ccc" } },
      tooltip: { trigger: "axis", valueFormatter: fmt },
      legend: { data: ["Receita", "Despesa"], textStyle: { color: "#aaa" } },
      xAxis: { type: "category", data: months, axisLabel: { color: "#aaa" } },
      yAxis: { type: "value", axisLabel: { color: "#aaa", formatter: fmt } },
      series: [
        { name: "Receita", type: "line", data: incomes, smooth: true },
        { name: "Despesa", type: "line", data: expenses, smooth: true },
      ],
    };
  }

  // bar (cashflow)
  return {
    title: { text: spec.title, textStyle: { fontSize: 13, color: "#ccc" } },
    tooltip: { trigger: "axis", valueFormatter: fmt },
    xAxis: { type: "category", data: spec.series.map((s) => s.name), axisLabel: { color: "#aaa" } },
    yAxis: { type: "value", axisLabel: { color: "#aaa", formatter: fmt } },
    series: [{ type: "bar", data: spec.series.map((s) => s.value) }],
  };
}

function render() {
  if (!chartEl.value) return;
  if (!instance) instance = echarts.init(chartEl.value, "dark");
  instance.setOption(buildOption(props.spec), true);
}

onMounted(render);
watch(() => props.spec, render, { deep: true });
</script>

<style scoped>
.chat-chart { width: 100%; height: 260px; }
</style>

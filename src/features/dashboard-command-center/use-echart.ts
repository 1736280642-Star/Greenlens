"use client";

import { useEffect, useRef } from "react";
import type { ECharts, EChartsOption } from "echarts";

type ChartEvents = Record<string, (params: unknown) => void>;

export function useEChart(option: EChartsOption, events: ChartEvents = {}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef(events);
  const optionRef = useRef(option);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    optionRef.current = option;
  }, [option]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    let disposed = false;
    let cleanup = () => undefined;

    void import("echarts").then((echarts) => {
      if (disposed) return;
      let chart: ECharts | null = null;
      const eventProxies = new Map<string, (params: unknown) => void>();
      const mountChart = () => {
        if (chart || element.clientWidth === 0 || element.clientHeight === 0) return;
        chart = echarts.getInstanceByDom(element) ?? echarts.init(element, undefined, { renderer: "canvas" });
        chartRef.current = chart;
        chart.setOption(optionRef.current, { notMerge: true, lazyUpdate: true });
        for (const eventName of Object.keys(eventsRef.current)) {
          const proxy = (params: unknown) => eventsRef.current[eventName]?.(params);
          eventProxies.set(eventName, proxy);
          chart.on(eventName, proxy);
        }
      };
      const observer = new ResizeObserver(() => {
        mountChart();
        chart?.resize();
      });
      observer.observe(element);
      mountChart();
      cleanup = () => {
        observer.disconnect();
        if (!chart) return;
        chartRef.current = null;
        for (const [eventName, proxy] of eventProxies) chart.off(eventName, proxy);
        chart.dispose();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return elementRef;
}

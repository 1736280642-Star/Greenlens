"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { analysisRepositoryMode } from "@/repositories";
import type { ReviewRecord, SampleGroup } from "@/types";

type Drawer = "none" | "notifications" | "command";

interface Notification {
  id: string;
  title: string;
  detail: string;
  time: string;
}

interface DemoState {
  year: number;
  industry: string;
  risk: string;
  sampleGroup: "all" | SampleGroup;
  selectedCompanyId: string | null;
  selectedReportYear: number | null;
  selectedEvidenceId: string | null;
  compareIds: string[];
  pendingReviews: number;
  reviews: ReviewRecord[];
  notifications: Notification[];
  drawer: Drawer;
  toast: string | null;
  setFilters: (filters: Partial<Pick<DemoState, "year" | "industry" | "risk" | "sampleGroup">>) => void;
  selectCompany: (id: string | null, reportYear?: number | null) => void;
  selectEvidence: (id: string | null) => void;
  toggleCompare: (id: string) => boolean;
  clearCompare: () => void;
  openDrawer: (drawer: Drawer) => void;
  notify: (title: string, detail: string) => void;
  showToast: (message: string | null) => void;
  setPendingReviews: (count: number) => void;
  saveReview: (review: ReviewRecord) => void;
  undoReview: (id: string) => void;
  reset: () => void;
}

export const defaultYear = analysisRepositoryMode === "mock" ? 2025 : 2024;

const defaults = {
  year: defaultYear,
  industry: "全部行业",
  risk: "全部风险",
  sampleGroup: "all" as const,
  selectedCompanyId: null,
  selectedReportYear: null,
  selectedEvidenceId: null,
  compareIds: ["cy-materials", "linhai-energy"],
  pendingReviews: 0,
  reviews: [] as ReviewRecord[],
  notifications: [
    { id: "welcome", title: "研究工作区已就绪", detail: "当前加载 2024 年 EAA 实数据样本。", time: "刚刚" },
  ] as Notification[],
  drawer: "none" as Drawer,
  toast: null as string | null,
};

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      ...defaults,
      setFilters: (filters) => set(filters),
      selectCompany: (id, reportYear = null) => set({ selectedCompanyId: id, selectedReportYear: id ? reportYear : null }),
      selectEvidence: (id) => set({ selectedEvidenceId: id }),
      toggleCompare: (id) => {
        const ids = get().compareIds;
        if (ids.includes(id)) {
          set({ compareIds: ids.filter((item) => item !== id) });
          return true;
        }
        if (ids.length >= 5) return false;
        set({ compareIds: [...ids, id] });
        return true;
      },
      clearCompare: () => set({ compareIds: [] }),
      openDrawer: (drawer) => set({ drawer }),
      notify: (title, detail) => set((state) => ({
        notifications: [{ id: crypto.randomUUID(), title, detail, time: "刚刚" }, ...state.notifications],
      })),
      showToast: (toast) => set({ toast }),
      setPendingReviews: (count) => set({ pendingReviews: Math.max(0, count) }),
      saveReview: (review) => set((state) => ({
        reviews: [review, ...state.reviews.filter((item) => item.id !== review.id)],
        pendingReviews: Math.max(0, state.pendingReviews - 1),
        notifications: [{ id: crypto.randomUUID(), title: "复核结果已保存", detail: "Dashboard 与任务队列已同步。", time: "刚刚" }, ...state.notifications],
        toast: "已保存复核结果",
        drawer: "none",
      })),
      undoReview: (id) => set((state) => ({
        reviews: state.reviews.filter((review) => review.id !== id),
        pendingReviews: state.pendingReviews + 1,
        toast: "已撤销复核结果",
      })),
      reset: () => set(defaults),
    }),
    {
      name: "greenlens-demo-state",
      partialize: (state) => ({
        year: state.year,
        industry: state.industry,
        risk: state.risk,
        sampleGroup: state.sampleGroup,
        compareIds: state.compareIds,
        pendingReviews: state.pendingReviews,
        reviews: state.reviews,
        notifications: state.notifications,
      }),
    },
  ),
);

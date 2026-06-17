/**
 * Prompt 模板（Pinia）—— 最小 stub。
 * 目前后端无模板端点，仅内存增删改占位；端点就绪后再接 api/client。
 * 不用 localStorage 持久化（CLAUDE.md 铁律 #9）。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

export interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
}

export const useTemplatesStore = defineStore("templates", () => {
  const templates = ref<PromptTemplate[]>([]);

  function add(t: PromptTemplate): void {
    templates.value.push(t);
  }
  function update(id: string, patch: Partial<Omit<PromptTemplate, "id">>): void {
    const cur = templates.value.find((t) => t.id === id);
    if (cur) Object.assign(cur, patch);
  }
  function remove(id: string): void {
    templates.value = templates.value.filter((t) => t.id !== id);
  }

  return { templates, add, update, remove };
});

import { createRouter, createWebHistory } from "vue-router";
import SubmitView from "./views/SubmitView.vue";
import TaskDetailView from "./views/TaskDetailView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: SubmitView },
    { path: "/tasks/:id", name: "task", component: TaskDetailView, props: true },
  ],
});

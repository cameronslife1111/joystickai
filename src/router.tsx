import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Self-heal on flaky/cellular networks: retry with backoff, refetch
        // when the connection returns, and keep trying even if the browser
        // briefly reports "offline".
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnReconnect: true,
        networkMode: "always",
      },
      mutations: {
        networkMode: "always",
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { zoneHeaders } from "@/lib/zone";
import { getLang, localizeLibrary, trServer } from "@/lib/i18n";

/** The server answers errors in Chinese; put the message in the interface language where we know it. */
function localizeErrorBody(text: string): string {
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object") {
      if (typeof body.error === "string") body.error = trServer(body.error);
      if (typeof body.message === "string") body.message = trServer(body.message);
      return JSON.stringify(body);
    }
  } catch { /* not JSON: translate the text as it is */ }
  return trServer(text);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${localizeErrorBody(text)}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: { ...zoneHeaders(), "X-Lang": getLang(), ...(data ? { "Content-Type": "application/json" } : {}) },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: { "X-Lang": getLang() },
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const data = await res.json();
    // Asset-library text is stored in Chinese; show it in the interface language.
    return String(queryKey[0]).includes("/api/library/") ? localizeLibrary(data) : data;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

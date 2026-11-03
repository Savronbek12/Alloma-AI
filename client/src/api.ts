import type { Alloma, ApiErrorBody, ListQuery, Meta, Paginated } from "../../shared/types";

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(BASE + path, { signal: signal ?? null, headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.message ?? `So'rov xatosi (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  meta: () => request<Meta>("/meta"),

  list(query: Partial<ListQuery>, signal?: AbortSignal) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return request<Paginated<Alloma>>(`/allomalar?${params}`, signal);
  },

  get: (slug: string) => request<Alloma>(`/allomalar/${encodeURIComponent(slug)}`),

  random: () => request<Alloma>("/allomalar/random"),
};

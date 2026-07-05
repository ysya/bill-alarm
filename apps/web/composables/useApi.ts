import { toast } from 'vue-sonner'

export function useApi() {
  const baseURL = '/api'

  const apiFetch = $fetch.create({
    onResponseError({ response }) {
      if (response.status === 401) {
        useAuthed().value = false
        navigateTo('/login')
      }
      else if (response.status === 403) {
        toast.error('權限不足')
      }
    },
  })

  async function get<T>(path: string): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`)
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`, { method: 'POST', body })
  }

  async function patch<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`, { method: 'PATCH', body })
  }

  async function del<T>(path: string): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`, { method: 'DELETE' })
  }

  return { get, post, patch, del }
}

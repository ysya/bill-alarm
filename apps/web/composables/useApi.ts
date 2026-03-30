export function useApi() {
  const baseURL = '/api'

  async function get<T>(path: string): Promise<T> {
    return $fetch<T>(`${baseURL}${path}`)
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    return $fetch<T>(`${baseURL}${path}`, { method: 'POST', body })
  }

  async function patch<T>(path: string, body?: unknown): Promise<T> {
    return $fetch<T>(`${baseURL}${path}`, { method: 'PATCH', body })
  }

  async function del<T>(path: string): Promise<T> {
    return $fetch<T>(`${baseURL}${path}`, { method: 'DELETE' })
  }

  return { get, post, patch, del }
}

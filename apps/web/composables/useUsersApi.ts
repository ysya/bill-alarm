export interface UserDTO {
  id: string
  username: string
  role: 'admin' | 'member'
  telegramBound: boolean
  createdAt: string
}

export function useUsersApi() {
  const { get, post, del } = useApi()
  return {
    list: () => get<UserDTO[]>('/users'),
    create: (username: string, password: string) => post<UserDTO>('/users', { username, password }),
    resetPassword: (id: string, password: string) => post<{ ok: boolean }>(`/users/${id}/reset-password`, { password }),
    remove: (id: string) => del<{ ok: boolean }>(`/users/${id}`),
  }
}

<script setup lang="ts">
import { toast } from 'vue-sonner'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { post } = useApi()

const form = ref({ current: '', next: '', confirm: '' })
const submitting = ref(false)

watch(() => props.open, (open) => {
  if (open) form.value = { current: '', next: '', confirm: '' }
})

async function submit() {
  if (form.value.next.length < 8) {
    toast.error('新密碼至少 8 碼')
    return
  }
  if (form.value.next !== form.value.confirm) {
    toast.error('兩次輸入的新密碼不一致')
    return
  }
  submitting.value = true
  try {
    await post('/auth/password', {
      currentPassword: form.value.current,
      newPassword: form.value.next,
    })
    toast.success('密碼已更新', { description: '其他裝置需重新登入。' })
    emit('update:open', false)
  }
  catch (e: any) {
    toast.error('修改失敗', { description: e?.data?.error ?? String(e) })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>修改密碼</DialogTitle>
        <DialogDescription>修改後其他已登入的裝置會被登出。</DialogDescription>
      </DialogHeader>
      <form
        class="space-y-3"
        @submit.prevent="submit"
      >
        <div class="space-y-2">
          <Label for="pwCurrent">目前密碼</Label>
          <Input
            id="pwCurrent"
            v-model="form.current"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <div class="space-y-2">
          <Label for="pwNext">新密碼</Label>
          <Input
            id="pwNext"
            v-model="form.next"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>
        <div class="space-y-2">
          <Label for="pwConfirm">確認新密碼</Label>
          <Input
            id="pwConfirm"
            v-model="form.confirm"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child>
            <Button
              type="button"
              variant="outline"
            >
              取消
            </Button>
          </DialogClose>
          <Button
            type="submit"
            :disabled="submitting"
          >
            {{ submitting ? '儲存中...' : '儲存' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

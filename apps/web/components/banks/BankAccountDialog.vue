<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { BankAccountDTO } from '@bill-alarm/shared/types'

const props = defineProps<{
  open: boolean
  editingAccount: BankAccountDTO | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'changed': []
}>()

const bankAccountApi = useBankAccountApi()

const accountForm = ref({ name: '', bankName: '', note: '' })
const submitting = ref(false)

// Re-populate from the target account (or reset to blank for "add") every
// time the dialog opens — mirrors the original page's openAccountDialog(),
// which always reset the form imperatively regardless of whether the same
// account was reopened.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  accountForm.value = {
    name: props.editingAccount?.name ?? '',
    bankName: props.editingAccount?.bankName ?? '',
    note: props.editingAccount?.note ?? '',
  }
})

async function handleSaveAccount() {
  if (!accountForm.value.name.trim() || !accountForm.value.bankName.trim()) {
    toast.error('請填寫帳戶名稱和銀行名稱')
    return
  }
  submitting.value = true
  try {
    const data = {
      name: accountForm.value.name.trim(),
      bankName: accountForm.value.bankName.trim(),
      note: accountForm.value.note.trim() || undefined,
    }
    if (props.editingAccount) {
      await bankAccountApi.update(props.editingAccount.id, data)
      toast.success('帳戶已更新')
    }
    else {
      await bankAccountApi.create(data)
      toast.success('帳戶已新增')
    }
    emit('update:open', false)
    emit('changed')
  }
  catch (error) {
    toast.error('操作失敗', { description: String(error) })
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
        <DialogTitle>{{ editingAccount ? '編輯帳戶' : '新增銀行帳戶' }}</DialogTitle>
        <DialogDescription>設定自動扣款來源的銀行帳戶資訊。</DialogDescription>
      </DialogHeader>
      <form
        class="space-y-4 py-2"
        @submit.prevent="handleSaveAccount"
      >
        <div class="space-y-2">
          <Label for="accName">帳戶名稱 *</Label>
          <Input
            id="accName"
            v-model="accountForm.name"
            placeholder="例：玉山薪轉帳戶"
          />
        </div>
        <div class="space-y-2">
          <Label for="accBank">銀行名稱 *</Label>
          <Input
            id="accBank"
            v-model="accountForm.bankName"
            placeholder="例：玉山銀行"
          />
        </div>
        <div class="space-y-2">
          <Label for="accNote">備註</Label>
          <Input
            id="accNote"
            v-model="accountForm.note"
            placeholder="選填"
          />
        </div>
        <DialogFooter class="gap-2">
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
            {{ editingAccount ? '儲存' : '新增' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

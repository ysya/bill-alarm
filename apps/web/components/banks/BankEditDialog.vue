<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BankPreset } from '@bill-alarm/shared/constants'
import type { BankAccountDTO, BankDTO } from '@bill-alarm/shared/types'

const props = defineProps<{
  open: boolean
  editingBank: BankDTO | null
  presets: BankPreset[]
  bankAccounts: BankAccountDTO[]
  showPassword: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:showPassword': [value: boolean]
  'changed': []
}>()

const bankApi = useBankApi()

const editForm = ref({ emailSenderPattern: '', emailSubjectPattern: '', pdfPassword: '', autoDebit: false, bankAccountId: '' as string | null })
const editingPreset = computed<BankPreset | null>(() => {
  if (!props.editingBank?.code) return null
  return props.presets.find(p => p.code === props.editingBank!.code) ?? null
})

// PDF password field: never pre-filled with the real value (server no longer sends it).
// Leave empty on save -> keep unchanged. "清除密碼" stages an explicit clear (sent as
// pdfPassword: null) that a freshly-typed password automatically supersedes.
const clearPdfPasswordOnSave = ref(false)
const pdfPasswordPlaceholder = computed(() => {
  if (clearPdfPasswordOnSave.value) return '將於儲存後清除'
  return props.editingBank?.hasPdfPassword ? '已設定（留空維持不變）' : '未設定'
})
watch(() => editForm.value.pdfPassword, (val) => {
  if (val) clearPdfPasswordOnSave.value = false
})

const submitting = ref(false)

// Re-populate from the target bank every time the dialog opens — mirrors
// the original page's openEdit(), which always reset the form/flags
// imperatively regardless of whether the same bank was reopened.
watch(() => props.open, (isOpen) => {
  if (!isOpen || !props.editingBank) return
  clearPdfPasswordOnSave.value = false
  emit('update:showPassword', false)
  editForm.value = {
    emailSenderPattern: props.editingBank.emailSenderPattern,
    emailSubjectPattern: props.editingBank.emailSubjectPattern,
    // Never pre-filled: the server no longer sends the plaintext password.
    pdfPassword: '',
    autoDebit: props.editingBank.autoDebit,
    bankAccountId: props.editingBank.bankAccountId,
  }
})

async function handleEdit() {
  if (!props.editingBank) return
  submitting.value = true
  try {
    const data: Record<string, unknown> = {
      emailSenderPattern: editForm.value.emailSenderPattern,
      emailSubjectPattern: editForm.value.emailSubjectPattern,
      autoDebit: editForm.value.autoDebit,
      bankAccountId: editForm.value.bankAccountId || null,
    }
    // Leave empty -> omit entirely (server keeps the existing password).
    // Typed a new value -> overwrite it (takes priority over a staged clear).
    // "清除密碼" with nothing typed -> explicit null (server clears it).
    // Never send '' — the server rejects it with 400.
    if (editForm.value.pdfPassword) {
      data.pdfPassword = editForm.value.pdfPassword
    }
    else if (clearPdfPasswordOnSave.value) {
      data.pdfPassword = null
    }
    await bankApi.update(props.editingBank.id, data)
    toast.success('設定已更新')
    emit('update:open', false)
    emit('changed')
  }
  catch (error) {
    toast.error('更新失敗', { description: String(error) })
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
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>編輯 {{ editingBank?.name }}</DialogTitle>
        <DialogDescription>調整 email 篩選規則和 PDF 密碼。只要 email 的寄件者與主旨都包含這兩個字串就會被掃描解析。</DialogDescription>
      </DialogHeader>
      <form
        class="space-y-4 py-2"
        @submit.prevent="handleEdit"
      >
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="eSender">寄件者包含</Label>
            <Button
              v-if="editingPreset && editingPreset.emailSender !== editForm.emailSenderPattern"
              type="button"
              size="sm"
              variant="ghost"
              class="h-6 px-2 text-xs"
              @click="editForm.emailSenderPattern = editingPreset!.emailSender"
            >
              還原預設
            </Button>
          </div>
          <Input
            id="eSender"
            v-model="editForm.emailSenderPattern"
            class="font-mono text-sm"
          />
          <p
            v-if="editingPreset"
            class="text-xs text-muted-foreground"
          >
            預設: <code class="px-1 rounded bg-muted">{{ editingPreset.emailSender }}</code>
          </p>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="eSubject">主旨包含</Label>
            <Button
              v-if="editingPreset && editingPreset.emailSubject !== editForm.emailSubjectPattern"
              type="button"
              size="sm"
              variant="ghost"
              class="h-6 px-2 text-xs"
              @click="editForm.emailSubjectPattern = editingPreset!.emailSubject"
            >
              還原預設
            </Button>
          </div>
          <Input
            id="eSubject"
            v-model="editForm.emailSubjectPattern"
            class="font-mono text-sm"
          />
          <p
            v-if="editingPreset"
            class="text-xs text-muted-foreground"
          >
            預設: <code class="px-1 rounded bg-muted">{{ editingPreset.emailSubject }}</code>
          </p>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="ePwd">PDF 密碼</Label>
            <Button
              v-if="editingBank?.hasPdfPassword"
              type="button"
              size="sm"
              variant="ghost"
              class="h-6 px-2 text-xs"
              :class="clearPdfPasswordOnSave ? 'text-destructive' : ''"
              @click="clearPdfPasswordOnSave = !clearPdfPasswordOnSave; editForm.pdfPassword = ''"
            >
              {{ clearPdfPasswordOnSave ? '復原' : '清除密碼' }}
            </Button>
          </div>
          <div class="relative">
            <Input
              id="ePwd"
              v-model="editForm.pdfPassword"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="pdfPasswordPlaceholder"
              class="pr-10"
            />
            <button
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              @click="emit('update:showPassword', !showPassword)"
            >
              <EyeOff
                v-if="showPassword"
                class="h-4 w-4"
              />
              <Eye
                v-else
                class="h-4 w-4"
              />
            </button>
          </div>
          <p
            v-if="clearPdfPasswordOnSave"
            class="text-xs text-destructive"
          >
            儲存後將清除目前的 PDF 密碼
          </p>
        </div>
        <Separator />
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label>自動扣款</Label>
            <p class="text-xs text-muted-foreground">
              啟用後將不再發送繳費提醒
            </p>
          </div>
          <Switch v-model="editForm.autoDebit" />
        </div>
        <div
          v-if="editForm.autoDebit"
          class="space-y-2"
        >
          <Label for="eBankAccount">扣款帳戶</Label>
          <Select v-model="editForm.bankAccountId">
            <SelectTrigger>
              <SelectValue placeholder="選擇扣款帳戶" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="null">
                無
              </SelectItem>
              <SelectItem
                v-for="acc in bankAccounts"
                :key="acc.id"
                :value="acc.id"
              >
                {{ acc.name }} ({{ acc.bankName }})
              </SelectItem>
            </SelectContent>
          </Select>
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
            儲存
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

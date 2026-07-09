<script setup lang="ts">
import { Building2, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BankDTO } from '@bill-alarm/shared/types'

const props = defineProps<{
  banks: BankDTO[]
  showPassword: boolean
}>()

const emit = defineEmits<{
  'update:showPassword': [value: boolean]
  'edit': [bank: BankDTO]
  'changed': []
}>()

const bankApi = useBankApi()

// Custom bank dialog
const customDialogOpen = ref(false)
const customForm = ref({ name: '', emailSenderPattern: '', emailSubjectPattern: '', pdfPassword: '' })

// Delete confirm
const deleteDialogOpen = ref(false)
const deletingBank = ref<BankDTO | null>(null)

const submitting = ref(false)

const customBanks = computed(() => props.banks.filter(b => !b.isBuiltin))

async function handleAddCustom() {
  if (!customForm.value.name.trim() || !customForm.value.emailSenderPattern.trim()) {
    toast.error('請填寫銀行名稱和寄件者')
    return
  }
  submitting.value = true
  try {
    await bankApi.create({
      name: customForm.value.name.trim(),
      emailSenderPattern: customForm.value.emailSenderPattern.trim(),
      emailSubjectPattern: customForm.value.emailSubjectPattern.trim() || '帳單',
      pdfPassword: customForm.value.pdfPassword.trim() || undefined,
    })
    toast.success('自訂銀行已新增')
    customDialogOpen.value = false
    customForm.value = { name: '', emailSenderPattern: '', emailSubjectPattern: '', pdfPassword: '' }
    emit('changed')
  }
  catch (error) {
    toast.error('新增失敗', { description: String(error) })
  }
  finally {
    submitting.value = false
  }
}

// Delete custom bank
async function handleDelete() {
  if (!deletingBank.value) return
  submitting.value = true
  try {
    await bankApi.remove(deletingBank.value.id)
    toast.success('已刪除')
    deleteDialogOpen.value = false
    emit('changed')
  }
  catch (error) {
    toast.error('刪除失敗', { description: String(error) })
  }
  finally {
    submitting.value = false
  }
}

// Toggle active state. Task 13 bugfix: original inline handler
// (`bankApi.update(...).then(fetchData)`) had no error handling — add a
// catch + toast, matching the other handlers in this file.
async function handleToggleActive(bank: BankDTO) {
  try {
    await bankApi.update(bank.id, { isActive: !bank.isActive })
    emit('changed')
  }
  catch (error) {
    toast.error('操作失敗', { description: String(error) })
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">
        自訂銀行
      </h2>
      <Button
        size="sm"
        @click="customDialogOpen = true"
      >
        <Plus class="mr-2 h-4 w-4" />
        新增
      </Button>
    </div>

    <Card v-if="customBanks.length === 0">
      <CardContent class="py-8 text-center text-sm text-muted-foreground">
        沒有自訂銀行。如果上面的清單沒有你的銀行，可以自行新增。
      </CardContent>
    </Card>

    <div
      v-else
      class="space-y-2"
    >
      <Card
        v-for="bank in customBanks"
        :key="bank.id"
      >
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <Building2 class="h-5 w-5 text-muted-foreground shrink-0" />
              <div class="min-w-0">
                <p class="font-medium text-sm truncate">
                  {{ bank.name }}
                </p>
                <p class="text-xs text-muted-foreground truncate">
                  {{ bank.emailSenderPattern }}
                </p>
                <Badge
                  v-if="bank.autoDebit"
                  variant="secondary"
                  class="text-xs mt-1"
                >
                  自動扣款
                </Badge>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click="emit('edit', bank)"
              >
                <Pencil class="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-destructive"
                @click="deletingBank = bank; deleteDialogOpen = true"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
              <Switch
                :model-value="bank.isActive"
                @update:model-value="handleToggleActive(bank)"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Custom Bank Dialog -->
    <Dialog v-model:open="customDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增自訂銀行</DialogTitle>
          <DialogDescription>手動設定 email 比對規則。</DialogDescription>
        </DialogHeader>
        <form
          class="space-y-4 py-2"
          @submit.prevent="handleAddCustom"
        >
          <div class="space-y-2">
            <Label for="cName">銀行名稱 *</Label>
            <Input
              id="cName"
              v-model="customForm.name"
              placeholder="例：星展銀行"
            />
          </div>
          <div class="space-y-2">
            <Label for="cSender">寄件者比對 *</Label>
            <Input
              id="cSender"
              v-model="customForm.emailSenderPattern"
              placeholder="例：dbs.com"
            />
          </div>
          <div class="space-y-2">
            <Label for="cSubject">主旨比對</Label>
            <Input
              id="cSubject"
              v-model="customForm.emailSubjectPattern"
              placeholder="例：帳單（預設）"
            />
          </div>
          <div class="space-y-2">
            <Label for="cPwd">PDF 密碼</Label>
            <div class="relative">
              <Input
                id="cPwd"
                v-model="customForm.pdfPassword"
                :type="showPassword ? 'text' : 'password'"
                placeholder="留空表示無密碼"
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
              新增
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm -->
    <Dialog v-model:open="deleteDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認刪除</DialogTitle>
          <DialogDescription>確定要刪除「{{ deletingBank?.name }}」嗎？</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <DialogClose as-child>
            <Button variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            :disabled="submitting"
            @click="handleDelete"
          >
            確認刪除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>

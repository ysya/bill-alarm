<script setup lang="ts">
import { Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BankAccountDTO } from '@bill-alarm/shared/types'

defineProps<{
  accounts: BankAccountDTO[]
}>()

const emit = defineEmits<{
  changed: []
}>()

const bankAccountApi = useBankAccountApi()

// Bank account dialog
const accountDialogOpen = ref(false)
const editingAccount = ref<BankAccountDTO | null>(null)

// Delete confirm
const deleteAccountDialogOpen = ref(false)
const deletingAccount = ref<BankAccountDTO | null>(null)

const submitting = ref(false)

function openAccountDialog(account?: BankAccountDTO) {
  editingAccount.value = account ?? null
  accountDialogOpen.value = true
}

async function handleDeleteAccount() {
  if (!deletingAccount.value) return
  submitting.value = true
  try {
    await bankAccountApi.remove(deletingAccount.value.id)
    toast.success('帳戶已刪除')
    deleteAccountDialogOpen.value = false
    emit('changed')
  }
  catch (error) {
    toast.error('刪除失敗', { description: String(error) })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          銀行帳戶
        </h2>
        <p class="text-sm text-muted-foreground mt-1">
          設定自動扣款來源帳戶
        </p>
      </div>
      <Button
        size="sm"
        @click="openAccountDialog()"
      >
        <Plus class="mr-2 h-4 w-4" />
        新增
      </Button>
    </div>

    <Card v-if="accounts.length === 0">
      <CardContent class="py-8 text-center text-sm text-muted-foreground">
        尚未設定銀行帳戶。新增帳戶後可在銀行設定中選擇自動扣款來源。
      </CardContent>
    </Card>

    <div
      v-else
      class="space-y-2"
    >
      <Card
        v-for="acc in accounts"
        :key="acc.id"
      >
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="min-w-0">
              <p class="font-medium text-sm">
                {{ acc.name }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ acc.bankName }}
              </p>
              <p
                v-if="acc.note"
                class="text-xs text-muted-foreground mt-0.5"
              >
                {{ acc.note }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click="openAccountDialog(acc)"
              >
                <Pencil class="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-destructive"
                @click="deletingAccount = acc; deleteAccountDialogOpen = true"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <BanksBankAccountDialog
      v-model:open="accountDialogOpen"
      :editing-account="editingAccount"
      @changed="emit('changed')"
    />

    <!-- Delete Account Confirm -->
    <Dialog v-model:open="deleteAccountDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認刪除</DialogTitle>
          <DialogDescription>確定要刪除「{{ deletingAccount?.name }}」嗎？</DialogDescription>
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
            @click="handleDeleteAccount"
          >
            確認刪除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>

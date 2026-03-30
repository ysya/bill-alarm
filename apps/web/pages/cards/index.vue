<script setup lang="ts">
import { CreditCard, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

interface CardItem {
  id: string
  bankName: string
  emailSenderPattern: string
  emailSubjectPattern: string
  pdfPassword?: string
  isActive: boolean
}

const cardApi = useCardApi()

const cards = ref<CardItem[]>([])
const loading = ref(true)

const dialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const editingCard = ref<CardItem | null>(null)
const deletingCard = ref<CardItem | null>(null)
const submitting = ref(false)

const defaultForm = {
  bankName: '',
  emailSenderPattern: '',
  emailSubjectPattern: '',
  pdfPassword: '',
  isActive: true,
}

const form = ref({ ...defaultForm })

const dialogTitle = computed(() => editingCard.value ? '編輯銀行' : '新增銀行')
const dialogDescription = computed(() =>
  editingCard.value
    ? '修改銀行的帳單郵件比對規則。'
    : '新增一家銀行及其帳單郵件比對規則。',
)

async function fetchData() {
  loading.value = true
  try {
    cards.value = await cardApi.list()
  }
  catch (error) {
    toast.error('載入資料失敗', { description: String(error) })
  }
  finally {
    loading.value = false
  }
}

function openCreateDialog() {
  editingCard.value = null
  form.value = { ...defaultForm }
  dialogOpen.value = true
}

function openEditDialog(card: CardItem) {
  editingCard.value = card
  form.value = {
    bankName: card.bankName,
    emailSenderPattern: card.emailSenderPattern,
    emailSubjectPattern: card.emailSubjectPattern,
    pdfPassword: card.pdfPassword ?? '',
    isActive: card.isActive,
  }
  dialogOpen.value = true
}

function openDeleteDialog(card: CardItem) {
  deletingCard.value = card
  deleteDialogOpen.value = true
}

async function handleSubmit() {
  if (!form.value.bankName.trim()) {
    toast.error('請填寫銀行名稱')
    return
  }

  submitting.value = true

  const payload = {
    bankName: form.value.bankName.trim(),
    emailSenderPattern: form.value.emailSenderPattern.trim(),
    emailSubjectPattern: form.value.emailSubjectPattern.trim(),
    pdfPassword: form.value.pdfPassword.trim() || undefined,
    isActive: form.value.isActive,
  }

  try {
    if (editingCard.value) {
      await cardApi.update(editingCard.value.id, payload)
      toast.success('銀行設定已更新')
    }
    else {
      await cardApi.create(payload)
      toast.success('銀行已新增')
    }
    dialogOpen.value = false
    await fetchData()
  }
  catch (error) {
    toast.error('操作失敗', { description: String(error) })
  }
  finally {
    submitting.value = false
  }
}

async function handleDelete() {
  if (!deletingCard.value) return

  submitting.value = true
  try {
    await cardApi.remove(deletingCard.value.id)
    toast.success('銀行已刪除')
    deleteDialogOpen.value = false
    await fetchData()
  }
  catch (error) {
    toast.error('刪除失敗', { description: String(error) })
  }
  finally {
    submitting.value = false
  }
}

onMounted(fetchData)
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">
          銀行管理
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          管理銀行帳單郵件比對規則。
        </p>
      </div>
      <Button @click="openCreateDialog">
        <Plus class="mr-2 h-4 w-4" />
        新增銀行
      </Button>
    </div>

    <Separator />

    <!-- Loading State -->
    <div
      v-if="loading"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <Card
        v-for="i in 3"
        :key="i"
        class="animate-pulse"
      >
        <CardHeader>
          <div class="h-5 w-32 bg-muted rounded" />
          <div class="h-4 w-24 bg-muted rounded mt-1" />
        </CardHeader>
        <CardContent>
          <div class="h-4 w-20 bg-muted rounded" />
        </CardContent>
      </Card>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="cards.length === 0"
      class="flex flex-col items-center justify-center py-16 text-center"
    >
      <div class="rounded-full bg-muted p-4 mb-4">
        <CreditCard class="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 class="text-lg font-semibold">
        尚未新增任何銀行
      </h3>
      <p class="text-sm text-muted-foreground mt-1 max-w-sm">
        新增銀行資訊後，系統將自動掃描對應的帳單郵件。
      </p>
      <Button
        class="mt-4"
        @click="openCreateDialog"
      >
        <Plus class="mr-2 h-4 w-4" />
        新增第一家銀行
      </Button>
    </div>

    <!-- Card Grid -->
    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <Card
        v-for="card in cards"
        :key="card.id"
        class="group transition-colors hover:border-foreground/20"
      >
        <CardHeader class="pb-3">
          <div class="flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <CardTitle class="text-base truncate">
                {{ card.bankName }}
              </CardTitle>
            </div>
            <Badge
              :variant="card.isActive ? 'default' : 'secondary'"
              :class="card.isActive ? 'bg-green-600 hover:bg-green-600/80' : 'bg-zinc-600 hover:bg-zinc-600/80'"
            >
              {{ card.isActive ? '啟用' : '停用' }}
            </Badge>
          </div>
        </CardHeader>

        <CardContent class="pb-3">
          <p class="text-xs text-muted-foreground truncate">{{ card.emailSenderPattern }}</p>
        </CardContent>

        <CardFooter class="pt-3 border-t border-border gap-2">
          <Button
            variant="ghost"
            size="sm"
            class="flex-1"
            @click="openEditDialog(card)"
          >
            <Pencil class="mr-1.5 h-3.5 w-3.5" />
            編輯
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="flex-1 text-destructive hover:text-destructive"
            @click="openDeleteDialog(card)"
          >
            <Trash2 class="mr-1.5 h-3.5 w-3.5" />
            刪除
          </Button>
        </CardFooter>
      </Card>
    </div>

    <!-- Create / Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>{{ dialogDescription }}</DialogDescription>
        </DialogHeader>

        <form
          class="space-y-4 py-2"
          @submit.prevent="handleSubmit"
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="bankName">銀行名稱 *</Label>
              <Input
                id="bankName"
                v-model="form.bankName"
                placeholder="例：國泰世華"
              />
            </div>
          </div>

          <Separator />

          <div class="space-y-2">
            <Label for="emailSenderPattern">寄件人比對規則</Label>
            <Input
              id="emailSenderPattern"
              v-model="form.emailSenderPattern"
              placeholder="例：noreply@cathayholdings.com"
            />
          </div>

          <div class="space-y-2">
            <Label for="emailSubjectPattern">主旨比對規則</Label>
            <Input
              id="emailSubjectPattern"
              v-model="form.emailSubjectPattern"
              placeholder="例：信用卡電子帳單"
            />
          </div>

          <div class="space-y-2">
            <Label for="pdfPassword">帳單 PDF 密碼</Label>
            <Input
              id="pdfPassword"
              v-model="form.pdfPassword"
              type="password"
              placeholder="通常為身分證字號或生日"
            />
            <p class="text-xs text-muted-foreground">各銀行帳單 PDF 加密密碼，通常為身分證字號、生日或自訂密碼。</p>
          </div>

          <div class="flex items-center justify-between rounded-lg border border-border p-3">
            <div class="space-y-0.5">
              <Label
                for="isActive"
                class="cursor-pointer"
              >啟用狀態</Label>
              <p class="text-xs text-muted-foreground">
                停用後將不再掃描此卡的帳單郵件。
              </p>
            </div>
            <Switch
              id="isActive"
              :checked="form.isActive"
              @update:checked="form.isActive = $event"
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
              <span
                v-if="submitting"
                class="mr-2 h-4 w-4 animate-spin i-lucide-loader-2"
              />
              {{ editingCard ? '儲存變更' : '新增銀行' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirmation Dialog -->
    <Dialog v-model:open="deleteDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認刪除</DialogTitle>
          <DialogDescription>
            確定要刪除「{{ deletingCard?.bankName }}」嗎？此操作無法復原，相關的帳單資料不會被刪除。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
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
            <span
              v-if="submitting"
              class="mr-2 h-4 w-4 animate-spin i-lucide-loader-2"
            />
            確認刪除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

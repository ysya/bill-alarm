<script setup lang="ts">
import { Building2, KeyRound, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface BankPreset {
  code: string
  name: string
  emailSender: string
  emailSubject: string
  passwordHint: string
}

interface EnabledBank {
  id: string
  code: string | null
  name: string
  emailSenderPattern: string
  emailSubjectPattern: string
  pdfPassword: string | null
  isBuiltin: boolean
  isActive: boolean
  _count?: { bills: number }
}

const bankApi = useBankApi()

const presets = ref<BankPreset[]>([])
const enabledBanks = ref<EnabledBank[]>([])
const loading = ref(true)

// Password dialog
const passwordDialogOpen = ref(false)
const passwordTarget = ref<{ code: string; name: string; hint: string; existingId?: string } | null>(null)
const passwordInput = ref('')

// Custom bank dialog
const customDialogOpen = ref(false)
const customForm = ref({ name: '', emailSenderPattern: '', emailSubjectPattern: '', pdfPassword: '' })

// Edit dialog (for tweaking patterns)
const editDialogOpen = ref(false)
const editingBank = ref<EnabledBank | null>(null)
const editForm = ref({ emailSenderPattern: '', emailSubjectPattern: '', pdfPassword: '' })

// Delete confirm
const deleteDialogOpen = ref(false)
const deletingBank = ref<EnabledBank | null>(null)

const submitting = ref(false)

async function fetchData() {
  loading.value = true
  try {
    const [p, e] = await Promise.all([bankApi.getPresets(), bankApi.list()])
    presets.value = p
    enabledBanks.value = e
  } catch (error) {
    toast.error('載入失敗', { description: String(error) })
  } finally {
    loading.value = false
  }
}

// Check if a preset bank is enabled
function isEnabled(code: string): boolean {
  return enabledBanks.value.some((b) => b.code === code && b.isActive)
}

function getEnabledRecord(code: string): EnabledBank | undefined {
  return enabledBanks.value.find((b) => b.code === code)
}

// Toggle a built-in bank
async function handleToggle(preset: BankPreset) {
  const record = getEnabledRecord(preset.code)

  if (record?.isActive) {
    // Disable
    try {
      await bankApi.disable(preset.code)
      toast.success(`已停用 ${preset.name}`)
      await fetchData()
    } catch (error) {
      toast.error('操作失敗', { description: String(error) })
    }
  } else if (record) {
    // Re-enable existing record
    try {
      await bankApi.enable(preset.code)
      toast.success(`已啟用 ${preset.name}`)
      await fetchData()
    } catch (error) {
      toast.error('操作失敗', { description: String(error) })
    }
  } else {
    // First time enable — ask for password
    passwordTarget.value = { code: preset.code, name: preset.name, hint: preset.passwordHint }
    passwordInput.value = ''
    passwordDialogOpen.value = true
  }
}

async function handleEnableWithPassword() {
  if (!passwordTarget.value) return
  submitting.value = true
  try {
    await bankApi.enable(passwordTarget.value.code, passwordInput.value || undefined)
    toast.success(`已啟用 ${passwordTarget.value.name}`)
    passwordDialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('啟用失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

// Edit bank settings
function openEdit(bank: EnabledBank) {
  editingBank.value = bank
  editForm.value = {
    emailSenderPattern: bank.emailSenderPattern,
    emailSubjectPattern: bank.emailSubjectPattern,
    pdfPassword: bank.pdfPassword ?? '',
  }
  editDialogOpen.value = true
}

async function handleEdit() {
  if (!editingBank.value) return
  submitting.value = true
  try {
    await bankApi.update(editingBank.value.id, {
      emailSenderPattern: editForm.value.emailSenderPattern,
      emailSubjectPattern: editForm.value.emailSubjectPattern,
      pdfPassword: editForm.value.pdfPassword || null,
    })
    toast.success('設定已更新')
    editDialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('更新失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

// Custom bank
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
    await fetchData()
  } catch (error) {
    toast.error('新增失敗', { description: String(error) })
  } finally {
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
    await fetchData()
  } catch (error) {
    toast.error('刪除失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

const customBanks = computed(() => enabledBanks.value.filter((b) => !b.isBuiltin))

onMounted(fetchData)
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">銀行管理</h1>
      <p class="text-sm text-muted-foreground mt-1">啟用你有帳單的銀行，系統會自動掃描對應的 email。</p>
    </div>

    <Separator />

    <!-- Built-in Banks -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold">台灣銀行</h2>

      <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card v-for="i in 6" :key="i" class="animate-pulse">
          <CardContent class="p-4"><div class="h-8 bg-muted rounded" /></CardContent>
        </Card>
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card
          v-for="preset in presets"
          :key="preset.code"
          class="transition-colors"
          :class="isEnabled(preset.code) ? 'border-primary/50' : ''"
        >
          <CardContent class="p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 min-w-0">
                <Building2 class="h-5 w-5 text-muted-foreground shrink-0" />
                <div class="min-w-0">
                  <p class="font-medium text-sm truncate">{{ preset.name }}</p>
                  <p class="text-xs text-muted-foreground truncate">{{ preset.emailSender }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <!-- Edit button (only if enabled) -->
                <Button
                  v-if="getEnabledRecord(preset.code)"
                  variant="ghost" size="icon" class="h-7 w-7"
                  @click.stop="openEdit(getEnabledRecord(preset.code)!)"
                >
                  <Pencil class="h-3.5 w-3.5" />
                </Button>
                <Switch
                  :checked="isEnabled(preset.code)"
                  @update:checked="handleToggle(preset)"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>

    <Separator />

    <!-- Custom Banks -->
    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">自訂銀行</h2>
        <Button size="sm" @click="customDialogOpen = true">
          <Plus class="mr-2 h-4 w-4" />
          新增
        </Button>
      </div>

      <Card v-if="customBanks.length === 0">
        <CardContent class="py-8 text-center text-sm text-muted-foreground">
          沒有自訂銀行。如果上面的清單沒有你的銀行，可以自行新增。
        </CardContent>
      </Card>

      <div v-else class="space-y-2">
        <Card v-for="bank in customBanks" :key="bank.id">
          <CardContent class="p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 min-w-0">
                <Building2 class="h-5 w-5 text-muted-foreground shrink-0" />
                <div class="min-w-0">
                  <p class="font-medium text-sm truncate">{{ bank.name }}</p>
                  <p class="text-xs text-muted-foreground truncate">{{ bank.emailSenderPattern }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="icon" class="h-7 w-7" @click="openEdit(bank)">
                  <Pencil class="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" class="h-7 w-7 text-destructive" @click="deletingBank = bank; deleteDialogOpen = true">
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
                <Switch :checked="bank.isActive" @update:checked="bankApi.update(bank.id, { isActive: !bank.isActive }).then(fetchData)" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>

    <!-- Password Dialog (first-time enable) -->
    <Dialog v-model:open="passwordDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>啟用 {{ passwordTarget?.name }}</DialogTitle>
          <DialogDescription>
            設定帳單 PDF 密碼。{{ passwordTarget?.hint ? `提示：${passwordTarget.hint}` : '' }}
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4 py-2" @submit.prevent="handleEnableWithPassword">
          <div class="space-y-2">
            <Label for="pwd">PDF 密碼</Label>
            <Input id="pwd" v-model="passwordInput" type="password" :placeholder="passwordTarget?.hint || '留空表示無密碼'" />
          </div>
          <DialogFooter class="gap-2">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">啟用</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Edit Dialog -->
    <Dialog v-model:open="editDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>編輯 {{ editingBank?.name }}</DialogTitle>
          <DialogDescription>微調 email 比對規則和 PDF 密碼。</DialogDescription>
        </DialogHeader>
        <form class="space-y-4 py-2" @submit.prevent="handleEdit">
          <div class="space-y-2">
            <Label for="eSender">寄件者比對</Label>
            <Input id="eSender" v-model="editForm.emailSenderPattern" />
          </div>
          <div class="space-y-2">
            <Label for="eSubject">主旨比對</Label>
            <Input id="eSubject" v-model="editForm.emailSubjectPattern" />
          </div>
          <div class="space-y-2">
            <Label for="ePwd">PDF 密碼</Label>
            <Input id="ePwd" v-model="editForm.pdfPassword" type="password" placeholder="留空表示無密碼" />
          </div>
          <DialogFooter class="gap-2">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">儲存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Custom Bank Dialog -->
    <Dialog v-model:open="customDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增自訂銀行</DialogTitle>
          <DialogDescription>手動設定 email 比對規則。</DialogDescription>
        </DialogHeader>
        <form class="space-y-4 py-2" @submit.prevent="handleAddCustom">
          <div class="space-y-2">
            <Label for="cName">銀行名稱 *</Label>
            <Input id="cName" v-model="customForm.name" placeholder="例：星展銀行" />
          </div>
          <div class="space-y-2">
            <Label for="cSender">寄件者比對 *</Label>
            <Input id="cSender" v-model="customForm.emailSenderPattern" placeholder="例：dbs.com" />
          </div>
          <div class="space-y-2">
            <Label for="cSubject">主旨比對</Label>
            <Input id="cSubject" v-model="customForm.emailSubjectPattern" placeholder="例：帳單（預設）" />
          </div>
          <div class="space-y-2">
            <Label for="cPwd">PDF 密碼</Label>
            <Input id="cPwd" v-model="customForm.pdfPassword" type="password" placeholder="留空表示無密碼" />
          </div>
          <DialogFooter class="gap-2">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">新增</Button>
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
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handleDelete">確認刪除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

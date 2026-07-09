<script setup lang="ts">
import { Building2, Eye, EyeOff, Pencil } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BankPreset } from '@bill-alarm/shared/constants'
import type { BankDTO } from '@bill-alarm/shared/types'

const props = defineProps<{
  presets: BankPreset[]
  banks: BankDTO[]
  loading: boolean
  showPassword: boolean
}>()

const emit = defineEmits<{
  'update:showPassword': [value: boolean]
  'edit': [bank: BankDTO]
  'changed': []
}>()

const bankApi = useBankApi()

// Password dialog (first-time enable)
const passwordDialogOpen = ref(false)
const passwordTarget = ref<{ code: string, name: string, hint: string, existingId?: string } | null>(null)
const passwordInput = ref('')
const submitting = ref(false)

// Check if a preset bank is enabled
function isEnabled(code: string): boolean {
  return props.banks.some(b => b.code === code && b.isActive)
}

function getEnabledRecord(code: string): BankDTO | undefined {
  return props.banks.find(b => b.code === code)
}

// Toggle a built-in bank
async function handleToggle(preset: BankPreset) {
  const record = getEnabledRecord(preset.code)

  if (record?.isActive) {
    // Disable
    try {
      await bankApi.disable(preset.code)
      toast.success(`已停用 ${preset.name}`)
      emit('changed')
    }
    catch (error) {
      toast.error('操作失敗', { description: String(error) })
    }
  }
  else if (record) {
    // Re-enable existing record
    try {
      await bankApi.enable(preset.code)
      toast.success(`已啟用 ${preset.name}`)
      emit('changed')
    }
    catch (error) {
      toast.error('操作失敗', { description: String(error) })
    }
  }
  else if (preset.passwordHint.includes('無密碼')) {
    // No password needed — enable directly
    try {
      await bankApi.enable(preset.code)
      toast.success(`已啟用 ${preset.name}`)
      emit('changed')
    }
    catch (error) {
      toast.error('啟用失敗', { description: String(error) })
    }
  }
  else {
    // First time enable — ask for password
    passwordTarget.value = { code: preset.code, name: preset.name, hint: preset.passwordHint }
    passwordInput.value = ''
    emit('update:showPassword', false)
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
    emit('changed')
  }
  catch (error) {
    toast.error('啟用失敗', { description: String(error) })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="space-y-4">
    <h2 class="text-lg font-semibold">
      內建銀行
    </h2>

    <div
      v-if="loading"
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
    >
      <Card
        v-for="i in 6"
        :key="i"
        class="animate-pulse"
      >
        <CardContent class="p-4">
          <div class="h-8 bg-muted rounded" />
        </CardContent>
      </Card>
    </div>

    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
    >
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
                <p class="font-medium text-sm truncate">
                  {{ preset.name }}
                </p>
                <p class="text-xs text-muted-foreground truncate">
                  {{ preset.emailSender }}
                </p>
                <Badge
                  v-if="getEnabledRecord(preset.code)?.autoDebit"
                  variant="secondary"
                  class="text-xs mt-1"
                >
                  自動扣款
                </Badge>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <!-- Edit button (only if enabled) -->
              <Button
                v-if="getEnabledRecord(preset.code)"
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click.stop="emit('edit', getEnabledRecord(preset.code)!)"
              >
                <Pencil class="h-3.5 w-3.5" />
              </Button>
              <Switch
                :model-value="isEnabled(preset.code)"
                @update:model-value="handleToggle(preset)"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Password Dialog (first-time enable) -->
    <Dialog v-model:open="passwordDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>啟用 {{ passwordTarget?.name }}</DialogTitle>
          <DialogDescription>
            設定帳單 PDF 密碼。{{ passwordTarget?.hint ? `提示：${passwordTarget.hint}` : '' }}
          </DialogDescription>
        </DialogHeader>
        <form
          class="space-y-4 py-2"
          @submit.prevent="handleEnableWithPassword"
        >
          <div class="space-y-2">
            <Label for="pwd">PDF 密碼</Label>
            <div class="relative">
              <Input
                id="pwd"
                v-model="passwordInput"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="passwordTarget?.hint || '留空表示無密碼'"
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
              啟用
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>
</template>
